with open('app.js', 'r') as f:
    lines = f.readlines()

# 找到函数开始和结束的位置
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if '// 一对一模式下过滤风玲的所有发言' in line:
        start_idx = i
    if start_idx is not None and 'return filtered;' in line:
        end_idx = i + 2  # 包含 closing brace
        break

if start_idx is not None and end_idx is not None:
    # 替换函数
    new_function = """// 一对一模式下过滤风玲的所有发言
function filterFenglingInOneOnOne(content) {
  // 使用正则表达式移除所有【风玲】开头的内容块
  // 匹配：【风玲】...直到下一个【某人】或结尾
  const fenglingPattern = /\\u3010\\u98ce\\u73b2\\u3011[^\\u3010]*/g;
  
  let filtered = content.replace(fenglingPattern, '');
  
  // 清理多余的空行（3个或更多换行符替换为2个）
  filtered = filtered.replace(/\n\\s*\n\\s*\n/g, '\n\n');
  filtered = filtered.trim();
  
  return filtered;
}
"""
    lines[start_idx:end_idx] = [new_function]
    
    with open('app.js', 'w') as f:
        f.writelines(lines)
    print(f'Fixed! Replaced lines {start_idx+1}-{end_idx}')
else:
    print('Function not found!')
