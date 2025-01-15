source "https://rubygems.org"

# 기본 gems
gem "base64"
gem "logger"
gem "bigdecimal"
gem "json"
gem "csv"

# Jekyll 및 관련 gems
gem "jekyll", "~> 4.3.4"
gem "kramdown"
gem "kramdown-parser-gfm"
gem "rouge"

# Jekyll 플러그인
group :jekyll_plugins do
  gem "jekyll-paginate"
  gem "jekyll-feed", "~> 0.12"
  gem "jekyll-sitemap"
  gem "jekyll-seo-tag"
  gem "jekyll-mermaid"
end

# Windows와 JRuby 관련
platforms :mingw, :x64_mingw, :mswin, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end

# Windows 성능 향상
gem "wdm", "~> 0.1", :platforms => [:mingw, :x64_mingw, :mswin]

# JRuby 관련
gem "http_parser.rb", "~> 0.6.0", :platforms => [:jruby]