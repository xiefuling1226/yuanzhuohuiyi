# 阿里云 OSS 静态网站部署（圆桌会议）

把 **`deploy-gitee`**（或 **`h5`**）里的静态文件放到 **对象存储 OSS**，开通「静态网站托管」，即可获得稳定访问地址（大陆线路通常优于纯海外 CDN）。

---

## 一、准备工作

1. 注册 [阿里云](https://www.aliyun.com/)并完成 **实名认证**。
2. 开通 **对象存储 OSS**（控制台搜索「OSS」）。

---

## 二、创建 Bucket

1. 进入 **对象存储 OSS** → **Bucket 列表** → **创建 Bucket**。
2. **地域**：选离你用户近的（如华东杭州 `oss-cn-hangzhou`）。
3. **读写权限**：静态站对外访问可选 **公共读**（若仅用固定域名 + 自有权限策略，可按官方文档收紧策略）。
4. **阻止公共访问**：若需匿名访问静态页，不要勾选「阻止公共访问」，或按控制台提示配置 **Bucket 策略** 允许 `GetObject`。
5. 记下：**Bucket 名称**、**地域（Endpoint）**，例如 Endpoint：`oss-cn-hangzhou.aliyuncs.com`。

---

## 三、开启静态网站托管

1. 打开该 Bucket → **数据管理** → **静态页面**（或 **基础设置** → **静态页面**）。
2. **默认首页**：`index.html`
3. **默认 404 页**（单页应用需要）：与 Netlify 类似，可填 **`index.html`**，避免前端路由刷新 404。
4. 保存后，控制台会给出 **访问端点**（网站域名），形如：  
   `http://<bucket>.oss-cn-<region>.aliyuncs.com`  
   **注意**：OSS 对外域名与是否 HTTPS、是否绑定自定义域名有关，以控制台显示为准。

---

## 四、上传文件

**方式 A：控制台** — **文件管理** → 上传 **`deploy-gitee`** 目录下全部文件到 Bucket **根目录**（保证根目录有 `index.html`）。

**方式 B：本机 ossutil**（推荐后续迭代）

```bash
# 安装 ossutil 后配置 AccessKey（控制台 RAM 用户创建）
ossutil sync ./deploy-gitee/ oss://你的Bucket名/ -f
```

**方式 C：GitHub Actions** — 见下文「自动同步」，推送 `main` 后自动上传到 OSS。

---

## 五、自定义域名与备案（可选）

- 若使用 **阿里云 OSS 绑定中国大陆访问的自定义域名**，按阿里云要求通常需要 **ICP 备案**。
- 仅用 OSS 默认提供的 **oss 域名**访问，一般可直接测试（具体以控制台说明为准）。

---

## 六、GitHub Actions 自动同步到 OSS（可选）

仓库已包含工作流：`.github/workflows/sync-to-aliyun-oss.yml`。

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中新增：

| Secret | 说明 |
|--------|------|
| `OSS_ACCESS_KEY_ID` | RAM 用户的 AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | RAM 用户的 AccessKey Secret |
| `OSS_BUCKET` | Bucket 名称 |
| `OSS_ENDPOINT` | 地域 Endpoint，如 `oss-cn-hangzhou.aliyuncs.com`（不要带 `https://`） |

**RAM 权限**：为该用户授权仅限目标 Bucket 的 OSS 读写（最小权限策略可用官方模板「OSS 完全权限」裁减为单 Bucket）。

未配置上述 Secret 时，该工作流会自动跳过 OSS 步骤，不影响其它流程。

---

## 七、与 Gitee / GitHub 的关系

- **源码**：仍以 GitHub 为主仓库。
- **Gitee**：可按需保留镜像。
- **阿里云 OSS**：作为 **对外访问的稳定静态托管**；密钥放在 GitHub Secrets，勿提交到仓库。
