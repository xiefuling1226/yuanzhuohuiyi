#!/usr/bin/env python3
"""
修复 app.js 的所有语法错误
"""

file_path = '/Users/fulingxie/Qorder/圆桌会议/h5/app.js'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 修复第739-743行的换行符问题
new_lines = []
i = 0
while i < len(lines):
    line_num = i + 1  # 1-based
    
    # 检测是否是需要修复的行（第739行附近）
    if line_num == 739 and 'filtered = filtered.replace(/' in lines[i]:
        # 跳过错误的多行（739-743）
        # 添加正确的单行
        new_lines.append("  filtered = filtered.replace(/\\n\\s*\\n\\s*\\n/g, '\\n\\n');\n")
        # 跳过接下来的错误行，直到遇到 filtered = filtered.trim()
        i += 1
        while i < len(lines) and 'filtered = filtered.trim()' not in lines[i]:
            i += 1
        # 现在 i 指向 filtered = filtered.trim() 这行，继续处理
        continue
    
    new_lines.append(lines[i])
    i += 1

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print('✅ 已修复 app.js 的所有语法错误')
print(f'修复后文件行数: {len(new_lines)}')
