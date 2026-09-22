// Phase 8.1 regexp.
// d8 --trace-regexp-bytecodes 08-regexp.js   (flag name may differ)
print('match', /a(b+)c/.exec('abbbc'));
print('fail', /a(b+)c/.exec('axc'));
