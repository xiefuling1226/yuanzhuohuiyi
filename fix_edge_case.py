#!/usr/bin/env python3
"""
修复 renderFinalContent 中的边界情况
"""

file_path = '/Users/fulingxie/Qorder/圆桌会议/h5/app.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 修改：如果是一对一模式且过滤后为空，不显示任何内容
old_code = """  if (parsed.length === 0) {
    // 没有标记，当做风玲的发言
    addSpeakerMessage('风玲', fullContent.trim(), 'fengling');
    return;
  }"""

new_code = """  if (parsed.length === 0) {
    // 一对一模式下，过滤后为空则不显示
    if (isOneOnOne) {
      return;
    }
    // 多人模式：没有标记，当做风玲的发言
    addSpeakerMessage('风玲', fullContent.trim(), 'fengling');
    return;
  }"""

content = content.replace(old_code, new_code)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('✅ 已修复边界情况')
