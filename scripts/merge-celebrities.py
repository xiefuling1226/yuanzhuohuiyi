#!/usr/bin/env python3
"""自动合并新名人到celebrities.js"""

import re
from pathlib import Path

def main():
    # 读取原始celebrities.js
    celeb_file = Path("/Users/fulingxie/AI编程/Qorder/圆桌会议/h5/celebrities.js")
    with open(celeb_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 读取9位新名人的SKILL.md
    skills_dir = Path("/Users/fulingxie/AI编程/Qorder/圆桌会议/.qoder/skills")
    
    new_celebrities = [
        {"id": "yang-zhenning", "displayName": "杨振宁", "title": "物理学大师", "domain": "科学与技术", "color": "#4A6A8B"},
        {"id": "von-neumann", "displayName": "冯·诺依曼", "title": "全能天才", "domain": "科学与技术", "color": "#4A6A8B"},
        {"id": "hawking", "displayName": "霍金", "title": "宇宙探索者", "domain": "科学与技术", "color": "#4A6A8B"},
        {"id": "shannon", "displayName": "香农", "title": "信息时代奠基人", "domain": "科学与技术", "color": "#4A6A8B"},
        {"id": "mengzi", "displayName": "孟子", "title": "儒家亚圣", "domain": "哲学与思想", "color": "#8B6F5C"},
        {"id": "du-fu", "displayName": "杜甫", "title": "诗圣", "domain": "文学与艺术", "color": "#9B6B9B"},
        {"id": "mo-yan", "displayName": "莫言", "title": "乡土叙事大师", "domain": "文学与艺术", "color": "#9B6B9B"},
        {"id": "yu-hua", "displayName": "余华", "title": "苦难叙事大师", "domain": "文学与艺术", "color": "#9B6B9B"},
        {"id": "rockefeller", "displayName": "洛克菲勒", "title": "石油大王", "domain": "商业与创业", "color": "#4A7C6F"}
    ]
    
    # 在"zu-chongzhi"之后，"};"之前插入新名人
    insert_marker = '  }\n};'
    
    new_entries = []
    for celeb in new_celebrities:
        skill_path = skills_dir / celeb["id"] / "SKILL.md"
        with open(skill_path, 'r', encoding='utf-8') as f:
            skill_content = f.read()
        
        # 提取description
        desc_match = re.search(r'description:\s*(.+)', skill_content)
        description = desc_match.group(1).strip() if desc_match else ""
        
        # 转义JSON字符串
        escaped_skill = skill_content.replace('\\', '\\\\').replace('\n', '\\n').replace('\r', '\\n').replace('"', '\\"').replace('\t', '    ')
        escaped_desc = description.replace('\\', '\\\\').replace('\n', '\\n').replace('\r', '\\n').replace('"', '\\"').replace('\t', '    ')
        
        entry = f'  }},\n  "{celeb["id"]}": {{\n    "name": "{celeb["id"]}",\n    "displayName": "{celeb["displayName"]}",\n    "title": "{celeb["title"]}",\n    "domain": "{celeb["domain"]}",\n    "color": "{celeb["color"]}",\n    "description": "{escaped_desc}",\n    "skill": "{escaped_skill}"\n'
        new_entries.append(entry)
    
    # 插入新条目
    all_entries = '\n  },'.join(new_entries)
    new_content = content.replace(insert_marker, all_entries + '\n  }\n};')
    
    # 更新DOMAIN_GROUPS
    domain_updates = {
        "科学与技术": ["yang-zhenning", "von-neumann", "hawking", "shannon"],
        "哲学与思想": ["mengzi"],
        "文学与艺术": ["du-fu", "mo-yan", "yu-hua"],
        "商业与创业": ["rockefeller"]
    }
    
    for domain, members in domain_updates.items():
        # 找到该domain的members数组
        pattern = rf'(\{{\s*"name":\s*"{re.escape(domain)}",\s*"members":\s*\[)([^\]]+)(\])'
        def add_members(match):
            existing = match.group(2).strip()
            new_members = ',\n      '.join([f'"{m}"' for m in members])
            return f'{match.group(1)}{existing},\n      {new_members}{match.group(3)}'
        
        new_content = re.sub(pattern, add_members, new_content, flags=re.MULTILINE)
    
    # 更新总数
    new_content = new_content.replace('// Total: 112 celebrities', '// Total: 121 celebrities')
    
    # 写回文件
    with open(celeb_file, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print(f"✅ 成功添加9位新名人到celebrities.js")
    print(f"✅ 总名人数量: 112 -> 121")
    print(f"\n新增名人:")
    for celeb in new_celebrities:
        print(f"  - {celeb['displayName']} ({celeb['id']}) - {celeb['domain']}")

if __name__ == "__main__":
    main()
