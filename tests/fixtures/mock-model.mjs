// Local-only UI acceptance fixture; no external provider calls or credentials.
import http from 'node:http';
http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const input = JSON.parse(body), prompt = input.messages?.[0]?.content || '';
  let content = '连接成功';
  if (prompt.includes('提取')) content = '医学 临床研究';
  if (prompt.includes('浙里寻研究助手')) {
    const resources = JSON.parse(prompt.split('候选目录：')[1].split('。用户选择的引用资料：')[0]);
    content = JSON.stringify({ reply: '【本机模拟接口验收】先界定研究对象和证据范围，再比较数据库覆盖内容。已收到当前阶段与勾选的资料。', recommendations: resources.slice(0, 2).map(r => ({ id: r.id, reason: '模拟接口返回的有效目录ID，用于验证在线推荐链路。' })) });
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
}).listen(4175, '127.0.0.1', () => console.log('Mock model: http://127.0.0.1:4175/v1'));
