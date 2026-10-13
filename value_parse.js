/* value_parse.js — mirrors pipeline/value_parse.py. Parses the free-text
   `value` field into a comparable number + unit family so the Data page can
   group and sort. Keep in sync with the Python version. */
(function () {
  'use strict';

  var WORD = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30,
    forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
  };
  var SCALE = {
    hundred: 1e2, thousand: 1e3, million: 1e6, lakh: 1e5,
    crore: 1e7, billion: 1e9, trillion: 1e12
  };
  var FILLER = ['and', 'or', 'to', 'plus', 'over', 'about', 'close', 'under',
    'roughly', 'like', 'around', 'nearly', 'almost', 'some', 'of', 'the', 'per',
    'every', 'at', 'least', 'more', 'less', 'than', 'approximately', 'estimated'];
  var MONEY = ['$', 'usd', 'dollar', 'rupee', 'inr', 'crore', 'lakh'];
  var INR = ['inr', 'rupee', 'crore', 'lakh'];
  var RANK = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth',
    'largest', 'smallest', 'top'];

  function norm(v) {
    v = v.toLowerCase();
    v = v.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');          // 450,000 -> 450000
    v = v.replace(/(\d) (?=\d{3}(?!\d))/g, '$1');           // 150 000 -> 150000
    v = v.replace(/^(\d+(?:\.\d+)?)\s+and\s+a\s+half\b/, '$1.5');
    var m = v.match(/^([a-z]+)\s+and\s+a\s+half\b/);
    if (m && WORD[m[1]] != null) v = (WORD[m[1]] + 0.5) + v.slice(m[0].length);
    m = v.match(/^(?:a|an|one)\s+(hour|minute|day|week|month|year)s?\s+and\s+a\s+half\b/);
    if (m) v = '1.5 ' + m[1] + 's' + v.slice(m[0].length);
    v = v.replace(/\bhalf\s+a\b/, '0.5');
    v = v.replace(/^(?:a|an)\b(?=\s)/, '1 ');
    v = v.replace(/\b(?:a|an)\s+(?=(?:hundred|thousand|million|billion|lakh|crore|trillion|dozen)\b)/, '1 ');
    return v;
  }

  function digits(t) {
    var out = [], m, re = /\d+(?:\.\d+)?/g;
    while ((m = re.exec(t))) { var f = parseFloat(m[0]); if (!isNaN(f)) out.push(f); }
    return out;
  }

  function words(t) {
    var total = 0, scale = 1, seenNum = false, seenScale = false, ws = t.match(/[a-z]+/g) || [];
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (FILLER.indexOf(w) !== -1 || w === 'half') continue;
      if (SCALE[w] != null) {
        if (seenNum && scale === 1) { scale = total; total = 0; seenNum = false; }
        else scale *= SCALE[w];
        seenScale = true;
        continue;
      }
      if (WORD[w] == null) break;
      var n = WORD[w];
      if (scale > 1) { total += n * scale; scale = 1; } else total += n;
      seenNum = true;
    }
    if (!seenNum && !seenScale) return null;
    if (!seenNum && seenScale) return scale;
    return total * scale;
  }

  function numbers(v) {
    var d = digits(v);
    if (d.length) return d;
    var w = words(v);
    return w ? [w] : [];
  }

  function scaleOf(v) {
    var s = 1, k;
    for (k in SCALE) if (new RegExp('\\b' + k + '\\b').test(v)) s = Math.max(s, SCALE[k]);
    return s;
  }

  function has(hay, needles) {
    for (var i = 0; i < needles.length; i++) if (hay.indexOf(needles[i]) !== -1) return true;
    return false;
  }
  function rx(re, s) { return re.test(s); }

  /* Returns { n: number|null, family: string } */
  function parse(value, unit) {
    if (value == null) return { n: null, family: 'other' };
    var v = norm(String(value).trim());
    var u = (unit || '').trim().toLowerCase();
    if (!v) return { n: null, family: 'other' };

    if (RANK.some(function (w) { return rx(new RegExp('\\b' + w + '\\b'), v); }) && !numbers(v).length) {
      return { n: null, family: 'rank' };
    }
    var nums = numbers(v);
    if (!nums.length) return { n: null, family: 'other' };

    var n = nums.length > 1 ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : nums[0];
    var sc = scaleOf(v);
    if (sc > 1) n *= sc;
    else if (rx(/\bdozen\b/, v)) n *= 12;

    /* unit first, value string only as fallback */
    if (u.indexOf('%') !== -1 || u === 'percent') return { n: n, family: 'percent' };
    if (u.indexOf('basis point') !== -1) return { n: n, family: 'basis_points' };
    if (has(u, MONEY)) return { n: n, family: has(u, INR) ? 'money_inr' : 'money_usd' };
    if (rx(/year/, u)) return { n: n, family: 'time_years' };
    if (rx(/month/, u)) return { n: n, family: 'time_months' };
    if (rx(/week|day|hour|minute/, u)) return { n: n, family: 'time_short' };
    if (u === 'x') return { n: n, family: 'multiple' };

    if (v.indexOf('%') !== -1) return { n: n, family: 'percent' };
    if (v.indexOf('basis point') !== -1) return { n: n, family: 'basis_points' };
    if (has(v, MONEY)) return { n: n, family: has(v, INR) ? 'money_inr' : 'money_usd' };
    if (rx(/\btimes\b/, v)) return { n: n, family: 'multiple' };
    if (rx(/\byears?\b/, v)) return { n: n, family: 'time_years' };
    if (rx(/\bmonths?\b/, v)) return { n: n, family: 'time_months' };
    if (rx(/\bweeks?\b|\bdays?\b|\bhours?\b/, v)) return { n: n, family: 'time_short' };
    return { n: n, family: 'count' };
  }

  var FAMILY_LABELS = {
    percent: 'Percentages', money_usd: 'Money (USD)', money_inr: 'Money (INR)',
    count: 'Counts & headcount', time_years: 'Time (years)',
    time_months: 'Time (months)', time_short: 'Time (days & weeks)',
    basis_points: 'Basis points', multiple: 'Multiples', rank: 'Ranks',
    other: 'Unparsed'
  };
  var FAMILY_ORDER = ['percent', 'money_usd', 'money_inr', 'multiple', 'count',
    'time_years', 'time_months', 'time_short', 'basis_points', 'rank', 'other'];

  /* Human-readable magnitude for the sort key badge */
  function fmt(n, family) {
    if (n == null) return '';
    /* calendar years read as years, not as "2.0k" */
    if (family === 'time_years' && n >= 1900 && n <= 2100 && n % 1 === 0) {
      return String(n);
    }
    if (family === 'percent') return n.toFixed(n % 1 ? 1 : 0) + '%';
    if (family === 'multiple') return n.toFixed(n % 1 ? 1 : 0) + '×';
    if (family === 'basis_points') return n.toFixed(0) + ' bps';
    var a = Math.abs(n);
    var s;
    if (a >= 1e12) s = (n / 1e12).toFixed(a / 1e12 >= 10 ? 0 : 1) + 'T';
    else if (a >= 1e9) s = (n / 1e9).toFixed(a / 1e9 >= 10 ? 0 : 1) + 'B';
    else if (a >= 1e6) s = (n / 1e6).toFixed(a / 1e6 >= 10 ? 0 : 1) + 'M';
    else if (a >= 1e3) s = (n / 1e3).toFixed(a / 1e3 >= 10 ? 0 : 1) + 'k';
    else s = n.toFixed(n % 1 ? 1 : 0);
    return s;
  }

  (typeof window !== 'undefined' ? window : globalThis).ValueParse =
    { parse: parse, fmt: fmt, FAMILY_LABELS: FAMILY_LABELS, FAMILY_ORDER: FAMILY_ORDER };
})();
