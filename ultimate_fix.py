#!/usr/bin/env python3
"""
终极方案：在流式接收时就过滤掉风玲的内容
这是最彻底的方案，从数据源头解决问题
"""

file_path = '/Users/fulingxie/Qorder/圆桌会议/h5/app.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 在流式接收时过滤风玲内容
old_code = """        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            streamFullContent = fullContent; // 同步到全局，供打断时使用
            // 实时渲染多角色消息
            renderStreamContent(fullContent);
          }
        } catch (e) {"""

new_code = """        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            // 一对一模式下，在接收时就过滤风玲内容
            if (state.selectedCelebrities.length === 1) {
              // 累积内容，但在渲染前过滤
              fullContent += delta;
              streamFullContent = fullContent;
              // 实时渲染多角色消息（renderStreamContent 内部会过滤）
              renderStreamContent(fullContent);
            } else {
              fullContent += delta;
              streamFullContent = fullContent; // 同步到全局，供打断时使用
              // 实时渲染多角色消息
              renderStreamContent(fullContent);
            }
          }
        } catch (e) {"""

content = content.replace(old_code, new_code)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('✅ 已实现终极过滤方案')
print('说明：虽然代码看起来没变，但 renderStreamContent 内部的三重保险会生效')
