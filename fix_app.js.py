#!/usr/bin/env python3
# 修复 app.js 中的语法错误

with open('/Users/fulingxie/Qorder/圆桌会议/h5/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 修复 filterFenglingInOneOnOne 函数中的换行符问题
# 找到错误的部分并替换
old_code = """  // 清理多余的空行（3个或更多换行符替换为2个）
  filtered = filtered.replace(/
\\s*
\\s*
/g, '

');"""

new_code = """  // 清理多余的空行（3个或更多换行符替换为2个）
  filtered = filtered.replace(/\n\\s*\n\\s*\n/g, '\n\n');"""

content = content.replace(old_code, new_code)

with open('/Users/fulingxie/Qorder/圆桌会议/h5/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('✅ 已修复 app.js 的语法错误')
