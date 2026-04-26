#!/usr/bin/env python3
"""从 .qoder/skills/*/SKILL.md 自动生成 h5/celebrities.js"""

import os, re, json

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS_DIR = os.path.join(BASE, '.qoder', 'skills')
OUTPUT = os.path.join(BASE, 'h5', 'celebrities.js')

DOMAIN_MAP = {
    '哲学与思想': ['kongzi','laozi','zhuangzi','wang-yangming','mozi','hanfeizi','socrates','plato','aristotle','nietzsche','hegel','kant','marx','luo-xiang','jiang-haisong','zeng-shiqiang','han-wangxi','yu-dan','fu-peirong'],
    '商业与创业': ['ren-zhengfei','steve-jobs','cao-dewang','zhang-yiming','jack-ma','inamori-kazuo','matsushita-konosuke','elon-musk','warren-buffett','jeff-bezos','bill-gates','sam-walton','peter-drucker','liu-run','hua-shan','cai-yue','liang-ning','wu-bofan'],
    '科学与技术': ['zhang-heng','zu-chongzhi','qian-xuesen','tu-youyou','yuan-longping','isaac-newton','albert-einstein','leonardo-da-vinci','alan-turing','richard-feynman','nikola-tesla','charles-darwin','wu-jun'],
    '政治与军事': ['sunzi','zhuge-liang','cao-cao','li-shimin','liu-bang','mao-zedong','qin-shihuang','wu-zetian','sima-guang','winston-churchill','abraham-lincoln','napoleon','julius-caesar','gandhi','nelson-mandela','donald-trump'],
    '文学与艺术': ['su-shi','lu-xun','li-bai','cao-xueqin','wang-xizhi','lin-yutang','sima-qian','luo-guanzhong','shi-naian','wu-chengen','wu-guanzhong','william-shakespeare','ludwig-van-beethoven','pablo-picasso','leo-tolstoy','vincent-van-gogh','ernest-hemingway','liu-yong','yi-zhongtian','jiang-xun','feng-tang','dang-nian-mingyue','liu-cixin'],
    '心理学与教育': ['sigmund-freud','carl-jung','alfred-adler','abraham-maslow','viktor-frankl','li-meijin','wu-zhihong','maria-montessori','tao-xingzhi','john-dewey','zhang-xuefeng','fan-deng'],
    '经济与金融': ['adam-smith','john-maynard-keynes','charlie-munger','ray-dalio','nassim-taleb','xue-zhaofeng','luo-zhenyu'],
    '生命科学与健康': ['wang-liming','yin-ye','zhai-shuangqing','xu-wenbing'],
}

DOMAIN_COLORS = {
    '哲学与思想': '#8B6F5C', '商业与创业': '#4A7C6F', '科学与技术': '#4A6A8B',
    '政治与军事': '#8B5C5C', '文学与艺术': '#6B5C8B', '心理学与教育': '#5C7A5C',
    '经济与金融': '#8B7A4A', '生命科学与健康': '#4A8B7A',
}

def find_domain(name):
    for domain, members in DOMAIN_MAP.items():
        if name in members:
            return domain
    return '其他'

def parse_skill(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    fm = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not fm:
        return None
    yaml_block = fm.group(1)
    nm = re.search(r'^name:\s*(.+)$', yaml_block, re.MULTILINE)
    dm = re.search(r'^description:\s*(.+)$', yaml_block, re.MULTILINE)
    if not nm:
        return None
    name = nm.group(1).strip()
    desc = dm.group(1).strip() if dm else ''
    cn = re.match(r'^(.+?)（', desc)
    display_name = cn.group(1) if cn else name
    tm = re.search(r'^#\s+.+?\s+·\s+(.+)$', content, re.MULTILINE)
    title = tm.group(1).strip() if tm else ''
    skill = re.sub(r'^---\n.*?\n---\n*', '', content, flags=re.DOTALL).strip()
    return {'name': name, 'displayName': display_name, 'title': title, 'description': desc, 'skill': skill}

def main():
    celebrities = {}
    for d in sorted(os.listdir(SKILLS_DIR)):
        sp = os.path.join(SKILLS_DIR, d, 'SKILL.md')
        if not os.path.isfile(sp):
            continue
        p = parse_skill(sp)
        if not p:
            continue
        domain = find_domain(p['name'])
        celebrities[p['name']] = {
            'name': p['name'],
            'displayName': p['displayName'],
            'title': p['title'],
            'domain': domain,
            'color': DOMAIN_COLORS.get(domain, '#8B6F5C'),
            'description': p['description'],
            'skill': p['skill'],
        }
    domains = []
    for dname, members in DOMAIN_MAP.items():
        domains.append({'name': dname, 'members': [m for m in members if m in celebrities]})
    js = f"// Auto-generated - DO NOT EDIT\n// Generated from .qoder/skills/*/SKILL.md\n// Total: {len(celebrities)} celebrities\n\n"
    js += f"const CELEBRITIES = {json.dumps(celebrities, ensure_ascii=False, indent=2)};\n\n"
    js += f"const DOMAINS = {json.dumps(domains, ensure_ascii=False, indent=2)};\n"
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        f.write(js)
    print(f"Done: {len(celebrities)} celebrities -> {OUTPUT}")

if __name__ == '__main__':
    main()
