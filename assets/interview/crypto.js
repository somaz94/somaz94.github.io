/* Interview page — decryption. Pure: no DOM, no storage, no network.
 *
 * The inverse of `_plugins/interview_encrypt.rb`. Keep the two in step; the wire
 * format is stated in both and nowhere else.
 *
 *   base64( salt[16] || iv[12] || ciphertext || gcm_tag[16] )
 *
 * The tag rides on the ciphertext because that is what `crypto.subtle.decrypt`
 * expects for AES-GCM; the build side does the concatenation.
 *
 * No verifier hash: a wrong key fails the GCM tag, and a stored hash would give
 * an offline attacker a cheaper target than the payload.
 *
 * Web Crypto needs a secure context; on plain http `crypto.subtle` is undefined
 * rather than throwing, so `available()` is checked up front instead of the case
 * surfacing as a wrong password.
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

  /* Tagged with `.kind` so the caller never has to parse the message. */
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
    /* Too short to hold a tag: corruption, not a wrong password. */
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
        /* The tag passed but the plaintext is not JSON: corruption, not 'wrong'. */
        if (e instanceof SyntaxError) {
          throw fail('malformed', '복호화는 됐지만 내용을 읽을 수 없습니다.');
        }
        throw fail('wrong', '비밀번호가 올바르지 않습니다.');
      });
  }

  global.IVCrypto = { unlock: unlock, available: available };
})(window);
