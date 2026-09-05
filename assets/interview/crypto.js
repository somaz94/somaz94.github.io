/* Interview page — decryption. Pure: no DOM, no storage, no network.
 *
 * The inverse of `_plugins/interview_encrypt.rb`. Keep the two in step; the wire
 * format is stated in both and nowhere else.
 *
 *   base64( salt[16] || iv[12] || ciphertext || gcm_tag[16] )
 *
 * The tag is appended to the ciphertext because that is exactly what
 * `crypto.subtle.decrypt` wants handed to it for AES-GCM. Ruby produces the two
 * separately, so the concatenation happens on the build side and this file does
 * not have to split them back out — it passes everything after the IV through.
 *
 * There is no separate "is this the right password" check, and deliberately so.
 * A wrong key fails the GCM tag and `decrypt` rejects; a stored verifier hash
 * would only give an offline attacker a cheaper target to grind than the payload
 * itself. The consequence is that a wrong password is indistinguishable from a
 * corrupt payload, which `unlock()` reports honestly rather than guessing.
 *
 * Web Crypto requires a secure context. https://somaz.blog qualifies and so does
 * localhost; a plain-http host does not, and `crypto.subtle` is then undefined
 * rather than throwing on use — which is why that case is checked up front and
 * named, instead of surfacing as "비밀번호가 올바르지 않습니다".
 */
(function (global) {
  'use strict';

  var SALT_BYTES = 16;
  var IV_BYTES = 12;

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* Errors are tagged with `.kind` so the UI can say which of the three things
     went wrong. Message text lives here rather than in ui.js because the caller
     would otherwise have to re-derive the distinction from a string. */
  function fail(kind, message) {
    var e = new Error(message);
    e.kind = kind;
    return e;
  }

  function available() {
    return !!(global.crypto && global.crypto.subtle && global.TextDecoder);
  }

  /* passphrase + payload -> the decoded question bank.
     Rejects with .kind of 'unsupported' | 'empty' | 'malformed' | 'wrong'. */
  function unlock(payloadB64, passphrase, iterations) {
    if (!available()) {
      return Promise.reject(fail(
        'unsupported',
        '이 브라우저에서는 복호화를 할 수 없습니다. HTTPS로 접속했는지 확인해 주세요.'
      ));
    }
    if (!payloadB64) {
      return Promise.reject(fail(
        'empty',
        '이 페이지에 암호화된 내용이 없습니다. 질문 뱅크 없이 빌드된 것 같습니다.'
      ));
    }

    var raw;
    try {
      raw = b64ToBytes(payloadB64);
    } catch (e) {
      return Promise.reject(fail('malformed', '페이지의 데이터가 손상되었습니다.'));
    }
    /* Below this length there is not even a tag to check, so `decrypt` would
       reject for a reason that has nothing to do with the password. */
    if (raw.length <= SALT_BYTES + IV_BYTES + 16) {
      return Promise.reject(fail('malformed', '페이지의 데이터가 손상되었습니다.'));
    }

    var salt = raw.slice(0, SALT_BYTES);
    var iv = raw.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
    var body = raw.slice(SALT_BYTES + IV_BYTES);
    var subtle = global.crypto.subtle;

    return subtle
      .importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );
      })
      .then(function (key) {
        return subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, body);
      })
      .then(function (buf) {
        return JSON.parse(new TextDecoder().decode(buf));
      })
      .catch(function (e) {
        /* A JSON.parse failure here would mean the tag passed and the plaintext
           is still not JSON, which cannot happen from a wrong password — so it
           is reported as corruption rather than folded into 'wrong'. */
        if (e instanceof SyntaxError) {
          throw fail('malformed', '복호화는 됐지만 내용을 읽을 수 없습니다.');
        }
        throw fail('wrong', '비밀번호가 올바르지 않습니다.');
      });
  }

  global.IVCrypto = { unlock: unlock, available: available };
})(window);
