# 个人心象博物馆同步至 AI 作品集

用户已确认源项目为 Personal Mind Museum，而非 Chronos Gallery。源站只读取和录制，没有修改其内容、权限或部署。

- 源站：https://personal-mind-museum.fuzzydrum8.chatgpt.site
- 源项目ID：`appgprj_6ad1e67418c08191b923e633d72aeca8`
- 采集日期：2026年10月21日
- 作品集项目标识：`museum`
- 目标ChatGPT Sites项目：`appgprj_6ac9980d662c8191950c57c4f4940e72`
- 目标Cloudflare Pages项目：`zhong-yuwen-ai-portfolio`

## 范围

只新增个人心象博物馆案例及其媒体，沿用项目卡片、单个展开面板、视频/截图切换和折叠图集。新增项目放在原三个精选之后，保留原精选、12个项目数据、原有截图和视频。其他页面区域仅同步项目数、界面数与更新时间，没有调整布局或样式。

新案例提供原站访问入口。项目分类为Web工程与AI应用；说明明确区分AI视觉内容展示和实时图像生成，保留源站来源标识。

## 截图与视频

8张实际页面截图：宇宙入口、八展厅导览、人与宇宙展厅、精选作品叙事、作品浏览器、在线图库检索、历史系列阅读、手机端入口。

视频直接录制已上线站点，包含展厅、作品切换、作品详情、关键词检索与历史系列阅读；未注入模拟接口或替换作品。成片剪除等待加载的时间，使用H.264 / YUV420p与Fast Start，提供中文字幕VTT和独立封面。

成片33.8秒，1600×900，约3.7MB；末尾对实际录制的历史阅读画面作短暂停留，便于看清内容。

截图和视频文件在 `output/mind-museum/`。录制脚本为 `scripts/record-mind-museum.py`；案例导入脚本为 `output/install-mind-museum.py`，导入只执行一次。

## 内容说明

录制时源站显示997件在线作品，数量可随源站继续同步而变化。历史图像采用当代视觉表达，并保留“待确认”等原站标记，不作为历史照片或史料证据。作品集不承诺站内实时生成图像。

完成后作品集总数为13个项目、107张截图、6段视频。

构建与内容核验通过：原12个项目数据逐项一致，所有原有CSS保持不变；非项目区域HTML只允许计数和更新时间变化。首屏、导航、工作方式、能力、经历、联系与页脚的代表元素，其计算样式与尺寸均与更新前一致。

本地浏览器核验通过：8张新截图全部解码，视频播放和20秒位置跳转有效；搜索、分类计数、单项目展开、截图模块选择、图集放大、原项目跳转和快捷搜索正常。7种视口尺寸没有横向溢出；动效开启时同样可用，没有脚本错误或资源404。

## 发布结果

- 源码提交：`a7f3175c7e2f98476afc46f0e5c5ce83d9933d69`
- ChatGPT Sites第24版，部署状态：`succeeded`
- ChatGPT Sites案例：https://zhong-yuwen-ai-portfolio.fuzzydrum8.chatgpt.site/#project-museum
- Cloudflare生产分支：`main`
- Cloudflare案例：https://zhong-yuwen-ai-portfolio.pages.dev/#project-museum
- Cloudflare固定部署地址：https://cfd0bdd7.zhong-yuwen-ai-portfolio.pages.dev/

## 视频传输兼容

线上核验发现Pages直接托管MP4时，初始响应缺少分段读取能力标识，浏览器可以播放但可跳转区间为零。Cloudflare部署增加仅匹配6个MP4路径的Pages适配层，返回规范的206、Content-Range、Content-Length和Accept-Ranges；HTML、样式、脚本与图片仍由原静态路径提供。没有增加外部存储、第三方播放器或新的账号授权。

适配层源码：站点仓库 `scripts/cloudflare-video-worker.mjs`。准备发布目录：`node scripts/prepare-cloudflare.mjs`，需在源码和已验证产物同步后运行，再将返回的目录交给`wrangler pages deploy`。原始`dist`仍用于ChatGPT Sites静态发布。

分段读取的闭合范围、开放范围、后缀范围、416错误、If-Range与HEAD均有针对性核验。参考：[Cloudflare Pages Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)、[Pages高级模式](https://developers.cloudflare.com/pages/functions/advanced-mode/)。

最终Cloudflare正式地址浏览器核验通过：新视频可播放并跳转至20秒，8张新截图全部可解码，搜索、展开/收起、图集放大和原项目入口正常，手机无横向溢出，没有脚本错误或资源404。结果保存于 `output/mind-museum/production-qa.json`。ChatGPT Sites正式入口同样返回HTTP 200并包含新案例与全部媒体入口。
