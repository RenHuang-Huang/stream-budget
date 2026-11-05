import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS as S, matchStreamer } from '../src/lib/budget.js';
import { segments, displayName, autoMatch } from '../src/lib/automatch.js';

// 依真實頻道名稱的各種寫法虛構的範例（中英混合、符號、emoji、日文、已畢業）
const real = [
  ['hivebee', '♡ cocor0'], ['youtube', '心 cocor0'],
  ['hivebee', '星野晴晴'], ['youtube', '星野晴晴 Hoshi Haru'],
  ['hivebee', '🤍莉雅·薇絲✨LIA-VESS'], ['youtube', '莉雅·薇絲 / Lia Vess'],
  ['youtube', '千千波露 MeowMeowPolu'], ['hivebee', '千千波露'],
  ['youtube', '星讀女僕茶館 HoshiyomiMaid Ch.'],
  ['youtube', '量產型犬飼步歌參參機 Kura33'],
  ['youtube', 'Mira ch. 米菈'],
  ['hivebee', '涼風晨歌'], ['hivebee', '春子ハルコ'],
  ['youtube', ''], ['twitch', ''],
].map(([platform, channel]) => ({ platform, channel }));

test('segments 依符號與文字種類切開、去掉常見字', () => {
  assert.deepEqual([...segments('星野晴晴 Hoshi Haru')], ['星野晴晴', 'hoshi', 'haru', 'hoshiharu']);
  assert.deepEqual([...segments('Mira ch. 米菈')], ['mira', '米菈']);
  assert.deepEqual([...segments('🤍莉雅·薇絲✨LIA-VESS')], ['莉雅', '薇絲', 'lia', 'vess', 'liavess']);
  assert.deepEqual([...segments('春子ハルコ')], ['春子ハルコ']);
  assert.deepEqual([...segments('心 cocor0')], ['cocor0']); // 「心」只有一個字，不拿來比對
});

test('displayName 取中文名、保留中間的「·」', () => {
  assert.equal(displayName(['莉雅·薇絲 / Lia Vess', '🤍莉雅·薇絲✨LIA-VESS']), '莉雅·薇絲');
  assert.equal(displayName(['星野晴晴 Hoshi Haru']), '星野晴晴');
  assert.equal(displayName(['Some Streamer']), 'Some Streamer');
});

test('autoMatch 用真實頻道：跨平台歸成同一人、不動已對應的、沒名稱的不處理', () => {
  const { settings, added, extended } = autoMatch(real, S);
  assert.deepEqual(added.sort(), ['米菈', '涼風晨歌', '千千波露', '春子ハルコ', '星讀女僕茶館', '星野晴晴', '莉雅·薇絲', '量產型犬飼步歌參參機'].sort());
  assert.deepEqual(extended, []);
  const by = Object.fromEntries(settings.streamers.map((s) => [s.name, s]));
  assert.deepEqual(by['星野晴晴'].aliases, { hivebee: ['星野晴晴'], youtube: ['星野晴晴 Hoshi Haru'], twitch: [] });
  assert.equal(by['莉雅·薇絲'].aliases.hivebee.length, 1);
  assert.equal(by['莉雅·薇絲'].aliases.youtube.length, 1);
  assert.ok(by['星野晴晴'].auto);
  assert.equal(by['心可可'].aliases.youtube.length, 1); // 已對應的心可可不變
  // 每個有名稱的頻道現在都對得到
  for (const { platform, channel } of real) if (channel) assert.ok(matchStreamer(settings, platform, channel), channel);
});

test('新頻道和既有直播主有共同片段時補進別名，不另建', () => {
  const s0 = { ...S, streamers: [...S.streamers, { id: 'haru', name: '晴晴', limit: 500, aliases: { hivebee: ['星野晴晴'], youtube: [], twitch: [] } }] };
  const { settings, added, extended } = autoMatch([{ platform: 'twitch', channel: 'hoshi_haru 星野晴晴' }, { platform: 'youtube', channel: 'Hoshi Haru' }], s0);
  assert.deepEqual(added, []);
  assert.deepEqual(extended, ['晴晴']);
  assert.deepEqual(settings.streamers.find((s) => s.id === 'haru').aliases.youtube, ['Hoshi Haru']);
});

test('使用者排除的頻道不再自動建立；沒有可處理的頻道時回傳原設定', () => {
  const r = autoMatch([{ platform: 'hivebee', channel: '涼風晨歌' }], { ...S, autoMatchIgnore: ['涼風晨歌'] });
  assert.deepEqual(r.added, []);
  assert.equal(r.settings.streamers.length, S.streamers.length);
});

test('常見字不會讓不相關的頻道併在一起', () => {
  const { added } = autoMatch([{ platform: 'youtube', channel: 'Alpha Ch.' }, { platform: 'youtube', channel: 'Beta Ch.' }], S);
  assert.equal(added.length, 2);
});

test('Twitch 帳號對上 YouTube 頻道（英文連寫）與 Bits 的「顯示名稱 (帳號)」', () => {
  const ch = [
    { platform: 'youtube', channel: '星野晴晴 Hoshi Haru' },
    { platform: 'twitch', channel: 'hoshiharu' },
    { platform: 'youtube', channel: '千千波露 MeowMeowPolu' },
    { platform: 'twitch', channel: '千千波露已畢業 (meowmeowpolu)' },
    { platform: 'twitch', channel: 'meowmeowpolu' },
  ];
  const { settings, added } = autoMatch(ch, S);
  assert.deepEqual(added.sort(), ['千千波露', '星野晴晴'].sort());
  const haru = settings.streamers.find((s) => s.name === '星野晴晴');
  assert.deepEqual(haru.aliases.twitch, ['hoshiharu']);
  // 心可可的 Twitch 帳號 cocor0_0303 本來就對得到
  assert.equal(matchStreamer(S, 'twitch', 'cocor0_0303'), 'cocoro');
  assert.equal(matchStreamer(S, 'twitch', '心可可_ココロ (cocor0_0303)'), 'cocoro');
});
