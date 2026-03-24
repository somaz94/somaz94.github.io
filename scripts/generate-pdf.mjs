#!/usr/bin/env node

import puppeteer from 'puppeteer';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// 간단한 정적 파일 서버
function startServer(port = 8787) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let filePath = join(ROOT_DIR, req.url === '/' ? 'index.html' : req.url);

      // permalink 경로 처리: /resume/ → private/resume.html
      if (req.url === '/resume/' || req.url === '/resume') {
        filePath = join(ROOT_DIR, 'private', 'resume.html');
      } else if (req.url === '/career/' || req.url === '/career') {
        filePath = join(ROOT_DIR, 'private', 'career.html');
      } else if (req.url === '/resume-career/' || req.url === '/resume-career') {
        filePath = join(ROOT_DIR, 'private', 'resume-career.html');
      }

      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(readFileSync(filePath));
    });

    server.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
      resolve(server);
    });
  });
}

async function generatePDF(page, url, outputPath, lang = 'ko') {
  console.log(`Generating: ${outputPath} (${lang})`);

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

  // 언어 전환
  await page.evaluate((lang) => {
    if (typeof switchLanguage === 'function') {
      switchLanguage(lang);
    }
  }, lang);

  // 렌더링 대기
  await new Promise((r) => setTimeout(r, 1000));

  // 다크모드 해제 (PDF는 라이트모드)
  await page.evaluate(() => {
    document.body.classList.remove('dark-mode');
  });

  // DOM 정리
  await page.evaluate(() => {
    // 1. 기존 CSS 완전 제거
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(el => el.remove());

    // 2. Jekyll frontmatter 제거
    const body = document.body;
    const firstText = body.firstChild;
    if (firstText && firstText.nodeType === 3 && firstText.textContent.includes('---')) {
      firstText.remove();
    }
    // body 내 남은 frontmatter 텍스트
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const toRemove = [];
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent.trim();
      if (t === '---' || t.includes('layout: null') || t.includes('permalink:')) {
        toRemove.push(walker.currentNode);
      }
    }
    toRemove.forEach(n => n.remove());

    // 3. 불필요 요소 완전 제거 (숨김이 아닌 삭제)
    const removeSelectors = [
      '.language-toggle', '.dark-mode-toggle', '.pdf-download-btn',
      '.scroll-progress-container', '#career-years', '#password-trigger',
      '#password-modal', '#phone-contact', '.profile-img', '.contact-icon',
    ];
    removeSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.remove());
    });

    // 4. 빈 contact-item 제거 + 라벨 추가
    const labelMap = {
      'genius5711@gmail.com': 'E-mail',
      'somaz.tistory.com': 'Blog(KR)',
      'somaz.blog': 'Blog(EN)',
      'github.com/somaz94': 'GitHub',
    };
    document.querySelectorAll('.contact-item').forEach(el => {
      if (!el.textContent.trim()) { el.remove(); return; }
      const text = el.textContent.trim();
      for (const [keyword, label] of Object.entries(labelMap)) {
        if (text.includes(keyword)) {
          const span = document.createElement('span');
          span.className = 'contact-label';
          span.textContent = label + ': ';
          el.insertBefore(span, el.firstChild);
          break;
        }
      }
    });

    // 5. 성과 지표 위에 소제목 추가
    document.querySelectorAll('.achievement-metrics').forEach(metrics => {
      const label = document.createElement('div');
      label.className = 'metrics-label';
      label.textContent = document.documentElement.lang === 'en' ? 'Key Achievements' : '주요 성과';
      metrics.insertBefore(label, metrics.firstChild);
    });

    // 6. 성과 지표를 불릿 리스트 형태로 재구성
    document.querySelectorAll('.metric-item').forEach(item => {
      const num = item.querySelector('.metric-number');
      const title = item.querySelector('.metric-title');
      const detail = item.querySelector('.metric-detail');
      const desc = item.querySelector('.metric-desc');

      // "숫자 설명 (detail)" 형태로 텍스트 조합
      let text = '';
      if (num) text += num.textContent.trim();
      if (title) text += ' ' + title.textContent.trim();
      else if (desc && !title) text += ' ' + desc.textContent.trim();
      if (detail) text += ' ' + detail.textContent.trim();

      item.innerHTML = text;
    });
  });

  // PDF 전용 스타일 적용 (scripts/pdf-style.css)
  const cssPath = resolve(__dirname, 'pdf-style.css');
  const cssContent = readFileSync(cssPath, 'utf-8');
  await page.addStyleTag({ content: cssContent });

  await new Promise((r) => setTimeout(r, 500));

  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', bottom: '12mm', left: '15mm', right: '15mm' },
    displayHeaderFooter: false,
  });

  console.log(`  ✓ ${outputPath}`);
}

async function main() {
  const OUTPUT_DIR = resolve(ROOT_DIR, 'pdf');
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const server = await startServer();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });

    const targets = [
      // 이력서 (resume.html)
      { path: '/resume/', lang: 'ko', file: '이력서_이동형.pdf' },
      { path: '/resume/', lang: 'en', file: 'Resume_DongHyungLee.pdf' },
      // 이력서+경력기술서 (resume-career.html)
      { path: '/resume-career/', lang: 'ko', file: '이력서_경력기술서_이동형.pdf' },
      { path: '/resume-career/', lang: 'en', file: 'Resume_Career_DongHyungLee.pdf' },
      // 경력기술서 (career.html)
      { path: '/career/', lang: 'ko', file: '경력기술서_이동형.pdf' },
      { path: '/career/', lang: 'en', file: 'Career_DongHyungLee.pdf' },
    ];

    for (const t of targets) {
      await generatePDF(
        page,
        `http://localhost:8787${t.path}`,
        join(OUTPUT_DIR, t.file),
        t.lang
      );
    }

    console.log(`\nPDF files saved to: ${OUTPUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
