#!/usr/bin/env python3
"""
安全地修复一对一模式下风玲闪现的问题
采用最保守的方案：在解析后过滤掉风玲段落
"""

file_path = '/Users/fulingxie/Qorder/圆桌会议/h5/app.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 方案：在 renderStreamContent 和 renderFinalContent 中，
# 解析完成后，如果是一对一模式，过滤掉所有风玲的段落

# 1. 修改 renderStreamContent 函数
old_stream = """  const parsed = parseMultiSpeaker(cleanContent, isOneOnOne);

  if (parsed.length === 0) {"""

new_stream = """  let parsed = parseMultiSpeaker(cleanContent, isOneOnOne);
  
  // 一对一模式下，过滤掉所有风玲的段落（双重保险）
  if (isOneOnOne) {
    parsed = parsed.filter(seg => seg.key !== 'fengling' && seg.speaker !== '风玲');
  }

  if (parsed.length === 0) {"""

content = content.replace(old_stream, new_stream)

# 2. 修改 renderFinalContent 函数
old_final = """  const parsed = parseMultiSpeaker(fullContent, isOneOnOne);
  if (parsed.length === 0) {"""

new_final = """  let parsed = parseMultiSpeaker(fullContent, isOneOnOne);
  
  // 一对一模式下，过滤掉所有风玲的段落（双重保险）
  if (isOneOnOne) {
    parsed = parsed.filter(seg => seg.key !== 'fengling' && seg.speaker !== '风玲');
  }
  
  if (parsed.length === 0) {"""

content = content.replace(old_final, new_final)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('✅ 已安全修复一对一模式风玲闪现问题')
print('修复方案：在解析后过滤掉所有风玲段落')
