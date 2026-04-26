#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量优化名人skill文件脚本
按照12要素模板重构所有名人skill文件
"""

import os
import re
from pathlib import Path

# 需要优化的名人列表（哲学与思想领域，排除已优化的孔子、老子）
CELEBRITIES_TO_OPTIMIZE = [
    'zhuangzi', 'mozi', 'hanfeizi', 
    'socrates', 'plato', 'aristotle',
    'nietzsche', 'hegel', 'kant', 
    'marx', 'wang-yangming'
]

SKILLS_DIR = Path('/Users/fulingxie/AI编程/Qorder/圆桌会议/.qoder/skills')

def read_skill_file(celebrity_id):
    """读取现有skill文件"""
    skill_path = SKILLS_DIR / celebrity_id / 'SKILL.md'
    if not skill_path.exists():
        return None
    with open(skill_path, 'r', encoding='utf-8') as f:
        return f.read()

def extract_frontmatter(content):
    """提取YAML frontmatter"""
    match = re.match(r'^---\n(.*?)\n---\n', content, re.DOTALL)
    if match:
        return match.group(1)
    return None

def extract_title(content):
    """提取标题"""
    match = re.search(r'^# (.+)$', content, re.MULTILINE)
    if match:
        return match.group(1)
    return None

def check_template_compliance(content):
    """检查是否符合新模板"""
    required_sections = [
        '## 1. 基本身份',
        '## 2. 时代背景与社会关系',
        '## 3. 性格与语气风格',
        '## 4. 核心知识体系',
        '## 5. 全部著作/核心思想来源',
        '## 6. 核心观点',
        '## 7. 思维模式',
        '## 8. 典型表达逻辑',
        '## 9. 知识边界与禁止内容',
        '## 10. 经典语录',
        '## 11. 对话示例',
        '## 12. 适用问题类型'
    ]
    
    missing = []
    for section in required_sections:
        if section not in content:
            missing.append(section)
    
    return missing

def main():
    print("=" * 80)
    print("名人skill文件批量优化检查工具")
    print("=" * 80)
    print()
    
    results = {
        'compliant': [],
        'needs_update': [],
        'not_found': []
    }
    
    for celebrity_id in CELEBRITIES_TO_OPTIMIZE:
        print(f"检查 {celebrity_id}...")
        content = read_skill_file(celebrity_id)
        
        if content is None:
            print(f"  ❌ 文件不存在")
            results['not_found'].append(celebrity_id)
            continue
        
        missing_sections = check_template_compliance(content)
        
        if not missing_sections:
            print(f"  ✅ 已符合新模板")
            results['compliant'].append(celebrity_id)
        else:
            print(f"  ⚠️  缺少 {len(missing_sections)} 个部分:")
            for section in missing_sections[:3]:  # 只显示前3个
                print(f"     - {section}")
            if len(missing_sections) > 3:
                print(f"     ... 等{len(missing_sections)}个部分")
            results['needs_update'].append(celebrity_id)
        
        print()
    
    print("=" * 80)
    print("检查结果汇总:")
    print(f"  ✅ 已符合模板: {len(results['compliant'])} 位")
    print(f"  ⚠️  需要优化: {len(results['needs_update'])} 位")
    print(f"  ❌ 文件不存在: {len(results['not_found'])} 位")
    print("=" * 80)
    
    if results['needs_update']:
        print("\n需要优化的名人:")
        for name in results['needs_update']:
            print(f"  - {name}")

if __name__ == '__main__':
    main()
