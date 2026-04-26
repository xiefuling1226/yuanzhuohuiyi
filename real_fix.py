#!/usr/bin/env python3
"""
真正彻底的解决方案：
在 parseMultiSpeaker 函数内部，当 skipPreText=true 时，
不仅跳过第一个标记之前的内容，还要在最终的 segments 中
排除所有风玲的段落
"""

file_path = '/Users/fulingxie/Qorder/圆桌会议/h5/app.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 修改 parseMultiSpeaker 函数，在返回前过滤风玲
old_code = """  // 第一个标记之前的文字归风玲（除非 skipPreText=true）
  if (!skipPreText && markers[0].index > 0) {
    const preText = content.slice(0, markers[0].index).trim();
    if (preText) {
      segments.push({ speaker: '风玲', key: 'fengling', text: preText });
    }
  }

  // 第二遍：按标记切分，每段文本从标记结尾到下一个标记开头
  for (let i = 0; i < markers.length; i++) {
    const speaker = markers[i].speaker;
    const textStart = markers[i].end;
    const textEnd = (i + 1 < markers.length) ? markers[i + 1].index : content.length;
    const text = content.slice(textStart, textEnd);

    // 自动查找或创建名人条目，确保每个发言人都有 key
    const key = ensureCelebrityEntry(speaker);

    segments.push({ speaker, key, text });
  }

  return segments;"""

new_code = """  // 第一遍：按标记切分，每段文本从标记结尾到下一个标记开头
  for (let i = 0; i < markers.length; i++) {
    const speaker = markers[i].speaker;
    
    // 如果 skipPreText=true（一对一模式），跳过所有风玲的标记
    if (skipPreText && speaker === '风玲') {
      continue;
    }
    
    const textStart = markers[i].end;
    const textEnd = (i + 1 < markers.length) ? markers[i + 1].index : content.length;
    const text = content.slice(textStart, textEnd);

    // 自动查找或创建名人条目，确保每个发言人都有 key
    const key = ensureCelebrityEntry(speaker);

    segments.push({ speaker, key, text });
  }
  
  // 只有在非一对一模式下，才添加第一个标记之前的文字给风玲
  if (!skipPreText && markers.length > 0 && markers[0].index > 0) {
    const preText = content.slice(0, markers[0].index).trim();
    if (preText) {
      segments.unshift({ speaker: '风玲', key: 'fengling', text: preText });
    }
  }

  return segments;"""

content = content.replace(old_code, new_code)

# 同时移除 renderStreamContent 和 renderFinalContent 中的过滤逻辑（不再需要）
# 因为 parseMultiSpeaker 已经处理了

content = content.replace(
    """  let parsed = parseMultiSpeaker(cleanContent, isOneOnOne);
  
  // 一对一模式下，过滤掉所有风玲的段落（双重保险）
  if (isOneOnOne) {
    parsed = parsed.filter(seg => seg.key !== 'fengling' && seg.speaker !== '风玲');
  }

  if (parsed.length === 0) {""",
    """  const parsed = parseMultiSpeaker(cleanContent, isOneOnOne);

  if (parsed.length === 0) {"""
)

content = content.replace(
    """  let parsed = parseMultiSpeaker(fullContent, isOneOnOne);
  
  // 一对一模式下，过滤掉所有风玲的段落（双重保险）
  if (isOneOnOne) {
    parsed = parsed.filter(seg => seg.key !== 'fengling' && seg.speaker !== '风玲');
  }
  
  if (parsed.length === 0) {
    // 一对一模式下，过滤后为空则不显示
    if (isOneOnOne) {
      return;
    }
    // 多人模式：没有标记，当做风玲的发言
    addSpeakerMessage('风玲', fullContent.trim(), 'fengling');
    return;
  }""",
    """  const parsed = parseMultiSpeaker(fullContent, isOneOnOne);
  
  if (parsed.length === 0) {
    // 没有标记，当做风玲的发言
    addSpeakerMessage('风玲', fullContent.trim(), 'fengling');
    return;
  }"""
)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('✅ 已实现真正彻底的解决方案')
print('核心改动：在 parseMultiSpeaker 内部就跳过风玲段落，避免创建 DOM 元素')
