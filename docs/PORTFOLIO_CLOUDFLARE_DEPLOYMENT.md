# AI作品集 Cloudflare Pages 发布

2026年10月20日，将作品集当前第21版原样发布到用户已登录的 Cloudflare 账号。没有修改页面源码、布局、内容或原有ChatGPT Sites地址。

- 正式地址：https://zhong-yuwen-ai-portfolio.pages.dev/
- Cloudflare项目：`zhong-yuwen-ai-portfolio`
- 账号ID：`394e8c179d7da8e5598f54704f6076c4`
- 生产分支：`main`
- 源码提交：`ec757c335dbd8116df88e5e310f95a62a7e2a529`
- 部署ID：`3556e769-3674-48d5-a28a-83c44301e0c9`
- 部署固定地址：https://3556e769.zhong-yuwen-ai-portfolio.pages.dev/
- 控制台：https://dash.cloudflare.com/394e8c179d7da8e5598f54704f6076c4/pages/view/zhong-yuwen-ai-portfolio
- 上传目录：`C:/Users/文/.codex/visualizations/2026/10/18/01a14ccd-e667-7953-b109-bd0eef8bbbb1/portfolio-site/dist`

使用本机已有Wrangler 4.149.0和Windows凭据管理器中的OAuth登录，具备Pages发布权限。没有索取、复制或写入用户的访问令牌。初次创建项目时，新版Wrangler默认委托Workers部署；因为当前为纯静态Pages站点，采用官方CLI提供的`pages project create ... --force`建立Pages项目。该项目已经创建，后续直接使用`pages deploy`，不再需要创建或传入`--force`。

## 后续更新

在站点源码目录运行原有生产构建和内容核验后，执行：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '394e8c179d7da8e5598f54704f6076c4'
npx --yes wrangler@4.149.0 pages deploy dist --project-name zhong-yuwen-ai-portfolio --branch main
```

生产构建保留12个项目、5段视频和99张截图。上传文件共121份（120个公开文件及1份`_headers`配置），约15.2MB，最大单文件约2.4MB。延续原站点不被搜索引擎索引的设置。

线上核验通过：正式地址HTTP 200，入口与关键资源内容摘要匹配；5个视频地址可用；浏览器中已实际验证视频播放/暂停、项目展开/收起及焦点恢复，390px手机视口无横向溢出，浏览器无脚本错误。

## 本地交付文件

- `output/cloudflare-portfolio/zhong-yuwen-ai-portfolio.zip`：可再次上传的静态发布包，根目录直接包含`index.html`。
- `output/cloudflare-portfolio/manifest.json`：源码版本、文件清单与SHA-256摘要。
- `output/cloudflare-portfolio/verification.json`：正式地址、文件内容及浏览器核验结果。

参考：[Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)。

## 2026年10月21日更新

已同步新增个人心象博物馆案例，生产固定地址：https://cfd0bdd7.zhong-yuwen-ai-portfolio.pages.dev/ ，源码提交：`a7f3175c7e2f98476afc46f0e5c5ce83d9933d69`。当前为13个项目、107张截图、6段视频。20日的本地ZIP与清单为首次部署留档；本次记录及最新ChatGPT Sites部署包见 `docs/PORTFOLIO_MIND_MUSEUM_SYNC.md` 和 `output/mind-museum/final-site-deploy.tar.gz`。

为保留视频进度跳转兼容处理，后续Cloudflare发布应先运行站点仓库的 `node scripts/prepare-cloudflare.mjs`，再部署其返回目录，取代上方首次发布时直接上传`dist`的命令。该适配层只处理视频路径。
