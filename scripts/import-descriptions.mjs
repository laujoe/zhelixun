/* Normalize public description sources for the application. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, process.argv[2] || 'src/data/source/descriptions.json');
const bytes = fs.readFileSync(source), rows = JSON.parse(bytes);
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/data/catalog.json')));
if (!Array.isArray(rows)) throw new Error('数据库详细说明必须为数组。');
const ids = new Set(), result = {}, warnings = [];
const validUrl = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol); } catch { return false; } };
for (const row of rows) {
  if (!catalog.some(db => db.id === row.id) || ids.has(row.id)) throw new Error(`未知或重复 ID：${row.id}`);
  if (catalog.find(db => db.id === row.id).name !== row.name) throw new Error(`数据库名称与目录不一致：${row.id}`);
  if (typeof row.description !== 'string' || !row.description.trim()) throw new Error(`缺少详细说明：${row.id}`);
  const paragraphs = row.description.trim().split(/\n\s*\n/).map(text => text.trim());
  if (paragraphs.length !== 3) throw new Error(`说明分段需要核对：${row.id}，预期内容、研究用途、访问条件三段。`);
  if (!Array.isArray(row.sources) || !row.sources.some(s => validUrl(s.url))) throw new Error(`缺少可追溯来源：${row.id}`);
  ids.add(row.id);
  const count = Array.from(row.description.replace(/\s/g, '')).length;
  if (count < 400 || count > 500) warnings.push(`${row.id} ${row.name}：${count} 字`);
  const body = row.description.split(/\n/)[0].replace(/^(按浙大图书馆的资源说明|根据浙大图书馆(?:资源)?说明|浙大图书馆说明)[，：]/, '');
  const sentences = body.match(/[^。！？]+[。！？]?/g) || [body];
  let summary = '';
  for (const sentence of sentences) { if (Array.from(summary).length >= 65 || (summary && Array.from(summary + sentence).length > 135)) break; summary += sentence; }
  if (Array.from(summary).length > 135) summary = Array.from(summary).slice(0, 130).join('') + '…';
  result[row.id] = {
    catalogId: row.id, name: row.name,
    sections: [
      { id: 'content', title: '资源内容', text: paragraphs[0] },
      { id: 'research', title: '研究用途与检索建议', text: paragraphs[1] },
      { id: 'access', title: '访问与使用条件', text: paragraphs[2] },
    ],
    summary, description: row.description, keywords: [...new Set([...(row.keywords || []), ...(row.subjects || []), row.resource_kind].filter(Boolean))],
    contentSubjects: row.subjects || [], language: row.language, resourceKind: row.resource_kind, coverage: row.coverage,
    verifiedAt: row.checked_date, verification: row.verification,
    sources: row.sources.filter(s => validUrl(s.url)).map(s => ({ url: s.url, title: s.label || '官方资料', status: s.status, sourceUpdatedAt: s.source_updated_at })),
    access: { campus: row.campus_access, offCampus: row.off_campus_access, license: row.license, notes: row.access_notes, officialEntryUrl: row.entry_url, directUrl: row.direct_url },
    sourceEvidence: row.source_evidence, descriptionChars: count,
  };
}
const missing = catalog.filter(db => !ids.has(db.id));
if (missing.length) throw new Error(`尚缺 ${missing.length} 条说明，未写入正式数据。`);
if (warnings.length && !process.argv.includes('--allow-length-exceptions')) throw new Error(`以下条目尚未达到 400–500 字，未写入正式数据：\n${warnings.join('\n')}`);
fs.writeFileSync(path.join(root, 'src/data/descriptions.json'), JSON.stringify(result, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'src/data/descriptions-manifest.json'), JSON.stringify({ source: path.relative(root, source), sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), importedAt: new Date().toISOString(), count: rows.length, minChars: Math.min(...Object.values(result).map(r => r.descriptionChars)), maxChars: Math.max(...Object.values(result).map(r => r.descriptionChars)), lengthExceptions: warnings, incompleteVerification: rows.filter(r => r.verification?.official_description !== '已读取官方资料').map(r => ({ id: r.id, name: r.name, status: r.verification?.official_description })) }, null, 2) + '\n');
console.log(`已接入 ${rows.length} 条说明，所有资源 ID 和来源已验证。${warnings.length ? `存在 ${warnings.length} 条已记录的长度例外。` : ''}`);
