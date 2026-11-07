"""「VR(Quest)で開く」の QR の答え合わせの見本を、Python の segno で 1 回だけ作る(npm test は Python を使わない)。

使い方(web で): python -X utf8 test/vr_qr_segno_make.py  → test/vr_qr_segno.json を書き直す
形: バイトの形(UTF-8 のバイトを渡す・ECI なし)・誤りの直し M(上げない)・版は自動(1〜10 だけ)・マスクは自動。
文: この画面の URL の形・版の境目の長さ・日本語、と、マスク 0〜7 がそれぞれ 2 回以上出るまで足した URL。
"""
import json
import pathlib
import sys

import segno

OUT = pathlib.Path(__file__).with_name('vr_qr_segno.json')


def make(text):
    qr = segno.make(text.encode('utf-8'), error='m', mode='byte', micro=False, boost_error=False)
    assert qr.error == 'M', (text, qr.error)
    assert 1 <= qr.version <= 10, (text, qr.version)
    rows = [''.join('1' if v else '0' for v in row) for row in qr.matrix]
    assert len(rows) == qr.version * 4 + 17 and all(len(r) == len(rows) for r in rows)
    return {'text': text, 'bytes': len(text.encode('utf-8')), 'version': qr.version, 'mask': qr.mask, 'rows': rows}


def main():
    texts = [
        'https://yuru.example/',
        'https://yuru.example/?character=norrie',
        'https://yuru.example/?character=norrie&look=2d',
        'https://yuru.example/?character=yokoso&look=3d',
        'https://yuru-chara-creator.example.app/?character=d_lantern&look=3d',
        'http://yuru.test:43123/?character=mikan',
        'HELLO',
        'ノリー',
        'ゆるキャラクリエイター https://yuru.example/',
    ]
    # 版の境目(M のバイトの数: 版 1=14, 2=26, 3=42, 4=62, 5=84, 6=106, 7=122, 8=152, 9=180, 10=213)
    for n in (1, 14, 15, 26, 27, 42, 43, 62, 63, 84, 85, 106, 107, 122, 123, 152, 153, 180, 181, 212, 213):
        head = 'https://yuru.example/?q='
        texts.append((head + 'abcdefghijklmnopqrstuvwxyz0123456789' * 7)[:n])
    cases = [make(t) for t in texts]
    seen = {m: 0 for m in range(8)}
    for c in cases:
        seen[c['mask']] += 1
    n = 0
    while min(seen.values()) < 2 and n < 400:
        c = make(f'https://yuru.example/?character=c{n:03d}&look={"2d" if n % 2 else "3d"}')
        n += 1
        if seen[c['mask']] < 2:
            seen[c['mask']] += 1
            cases.append(c)
    data = {
        'made_with': f'segno {segno.__version__} (Python {sys.version.split()[0]})',
        'options': {'error': 'M', 'mode': 'byte', 'encoding': 'utf-8', 'eci': False, 'boost_error': False, 'version': 'auto (1-10)', 'mask': 'auto'},
        'masks_seen': seen,
        'cases': cases,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    print(f'{len(cases)} cases -> {OUT.name}  masks {seen}  versions {sorted({c["version"] for c in cases})}')


if __name__ == '__main__':
    main()
