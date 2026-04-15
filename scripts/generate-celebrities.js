// NOTE: Node.js not available on this machine.
// Use scripts/generate-celebrities.py instead.
// python3 scripts/generate-celebrities.py

const SKILLS_DIR = path.join(__dirname, '..', '.qoder', 'skills');
const OUTPUT_FILE = path.join(__dirname, '..', 'h5', 'celebrities.js');

// 领域分类映射
const DOMAIN_MAP = {
  '哲学与思想': ['kongzi','laozi','zhuangzi','wang-yangming','mozi','hanfeizi','socrates','plato','aristotle','nietzsche','hegel','kant','marx'],
  '商业与创业': ['ren-zhengfei','steve-jobs','cao-dewang','zhang-yiming','jack-ma','inamori-kazuo','matsushita-konosuke','elon-musk','warren-buffett','jeff-bezos','bill-gates','sam-walton'],
  '科学与技术': ['zhang-heng','zu-chongzhi','qian-xuesen','tu-youyou','yuan-longping','isaac-newton','albert-einstein','leonardo-da-vinci','alan-turing','richard-feynman','nikola-tesla','charles-darwin'],
  '政治与军事': ['sunzi','zhuge-liang','cao-cao','li-shimin','liu-bang','mao-zedong','qin-shihuang','wu-zetian','sima-guang','winston-churchill','abraham-lincoln','napoleon','julius-caesar','gandhi','nelson-mandela','donald-trump'],
  '文学与艺术': ['su-shi','lu-xun','li-bai','cao-xueqin','wang-xizhi','lin-yutang','sima-qian','luo-guanzhong','shi-naian','wu-chengen','wu-guanzhong','william-shakespeare','ludwig-van-beethoven','pablo-picasso','leo-tolstoy','vincent-van-gogh','ernest-hemingway'],
  '心理学与人文': ['sigmund-freud','carl-jung','alfred-adler','abraham-maslow','viktor-frankl'],
  '经济与金融': ['adam-smith','john-maynard-keynes','charlie-munger','ray-dalio','nassim-taleb','peter-drucker','xue-zhaofeng'],
  '知识传播与咨询': ['luo-zhenyu','liu-run','hua-shan','wu-bofan','liang-ning','cai-yue'],
  '教育与成长': ['maria-montessori','tao-xingzhi','john-dewey','zhang-xuefeng'],
  '生命科学': ['wu-jun','wang-liming','yin-ye'],
};

// 为每个领域分配一组颜色
const DOMAIN_COLORS = {
  '哲学与思想': ['#8B6F5C','#7A6B5D','#9C7A62','#6B5B4E','#A08672','#887460','#7E6E5E','#946E56','#8C7864','#756050','#9B8570','#847058','#6E5D4E'],
  '商业与创业': ['#4A7C6F','#3D6B60','#5A8C7E','#2E5A4F','#6A9C8E','#4E7E70','#3B6A5E','#5E8E80','#2C584D','#6E9E90','#458070','#3A6960'],
  '科学与技术': ['#4A6A8B','#3D5C7A','#5A7A9C','#2E4E6B','#6A8AAC','#4E6C8E','#3B5A7B','#5E7E9E','#2C4C69','#6E8EAE','#456C8E','#3A5C7A'],
  '政治与军事': ['#8B5C5C','#7A4E4E','#9C6A6A','#6B4040','#AC7A7A','#8E5050','#7B4545','#9E6060','#693C3C','#AE7E7E','#8E5555','#7A4848','#6B3E3E','#9C6565','#7E5050','#8B5858'],
  '文学与艺术': ['#6B5C8B','#5E4E7A','#7A6A9C','#50406B','#8A7AAC','#6E508E','#5B457B','#7E609E','#4E3C69','#8E7EAE','#6E558E','#5E487A','#704C8B','#6A5A8E','#7E6A9C','#5C4A7A','#8B7090'],
  '心理学与人文': ['#5C7A5C','#4E6B4E','#6A8C6A','#406040','#7A9C7A'],
  '经济与金融': ['#8B7A4A','#7A6A3D','#9C8A5A','#6B5A2E','#AC9A6A','#8E7C4E','#7B6A3B'],
  '知识传播与咨询': ['#5C6B8B','#4E5E7A','#6A7A9C','#40506B','#7A8AAC','#4E6080'],
  '教育与成长': ['#7A5C7A','#6B4E6B','#8C6A8C','#604060'],
  '生命科学': ['#4A8B7A','#3D7A6A','#5A9C8A'],
};

function parseSkillFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // 解析 YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);

  if (!nameMatch) return null;

  const name = nameMatch[1].trim();
  const description = descMatch ? descMatch[1].trim() : '';

  // 从 description 提取中文名
  const cnNameMatch = description.match(/^(.+?)（/);
  const displayName = cnNameMatch ? cnNameMatch[1] : name;

  // 从 markdown 标题提取 title
  const titleMatch = content.match(/^#\s+.+?\s+·\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // 完整 skill 内容（去掉 frontmatter）
  const skill = content.replace(/^---\n[\s\S]*?\n---\n*/, '').trim();

  return { name, displayName, title, description, skill };
}

function findDomain(name) {
  for (const [domain, members] of Object.entries(DOMAIN_MAP)) {
    if (members.includes(name)) return domain;
  }
  return '其他';
}

function getColor(name) {
  const domain = findDomain(name);
  const members = DOMAIN_MAP[domain] || [];
  const colors = DOMAIN_COLORS[domain] || ['#8B6F5C'];
  const idx = members.indexOf(name);
  return colors[idx % colors.length];
}

function main() {
  const dirs = fs.readdirSync(SKILLS_DIR).filter(d => {
    const stat = fs.statSync(path.join(SKILLS_DIR, d));
    return stat.isDirectory();
  });

  const celebrities = {};
  let count = 0;

  for (const dir of dirs) {
    const skillPath = path.join(SKILLS_DIR, dir, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;

    const parsed = parseSkillFile(skillPath);
    if (!parsed) continue;

    celebrities[parsed.name] = {
      name: parsed.name,
      displayName: parsed.displayName,
      title: parsed.title,
      domain: findDomain(parsed.name),
      color: getColor(parsed.name),
      description: parsed.description,
      skill: parsed.skill,
    };
    count++;
  }

  // 构建 DOMAINS 数组
  const domains = Object.entries(DOMAIN_MAP).map(([name, members]) => ({
    name,
    members: members.filter(m => celebrities[m]),
  }));

  // 生成 JS 文件
  const output = `// 自动生成 - 请勿手动编辑
// 由 scripts/generate-celebrities.js 从 .qoder/skills/*/SKILL.md 生成
// 共 ${count} 位名人

const CELEBRITIES = ${JSON.stringify(celebrities, null, 2)};

const DOMAINS = ${JSON.stringify(domains, null, 2)};
`;

  fs.writeFileSync(OUTPUT_FILE, output, 'utf-8');
  console.log(`✅ 已生成 celebrities.js，共 ${count} 位名人`);
}

main();
