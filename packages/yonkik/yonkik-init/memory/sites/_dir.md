# 站点目录（一行式）

| 站点 | 状态 | 一句话 |
|---|---|---|
| www.cc98.org | done | 浙大论坛；API 在 api.cc98.org，Bearer token，纯 HTTP；**电子书从哪找**见 `sites/www.cc98.org/ebook-sources.md` |
| courses.zju.edu.cn | done | 学在浙大 TronClass；CAS 两阶段；附件两步法 |
| zdbk.zju.edu.cn | done | 本科教务；通知免读，分页须 POST |
| classroom.zju.edu.cn | done | 智云课堂；课表/回放/字幕/AI PPT |
| car.zju.edu.cn | done | 校车预约；实时余票；晚 8 点规则 |
| www.life.zju.edu.cn | done | 班车查询；数据接口全免登录 |
| zjuers.com | done | 导航枢纽；98 站目录 |
| chalaoshi.xhuya.cn | done | 查老师；gpa op 一次给全部老师均绩 |
| pintia.cn | done | 拼题A；登录须 playwright（TCaptcha） |
| 10.203.16.55 | done | 物理实验；API 在 :8098/lab-course，snake_case |
| bksy.zju.edu.cn | done | 培养方案 PDF 免登录直链 |
| service.zju.edu.cn | done | 49 应用目录/办事指南，全免登录 |
| qzonline.zju.edu.cn | done | 场馆预约；161 自习室实时占座 |
| chat.zju.edu.cn | done | 模型广场/24 智能体 |
| zju.summon.serialssolutions.com | done | 280 万级检索，免登录 |
| map.zju.edu.cn | done | 1334 POI / 9 校区，免登录 |
| mirrors.zju.edu.cn | done | 193 源可用性，免登录 |
| www.career.zju.edu.cn | done | 9840 宣讲会，免登录 |
| cscy.zju.edu.cn | done | 检索证明委托三页，免登录 |
| eta.zju.edu.cn | done | 奖学金；免登录≈零数据 |
| scholar.edu.cn | done | 国际学术资源服务 |
| **www.douyin.com** | **done** | **免登录只到列表层：热榜 JSON 可用；详情/搜索被 Argus 锁** |
| **www.xiaohongshu.com** | **done** | **免登录只给目录不给内容：50 万 noteId，正文全 302 登录** |
| s1.zju.edu.cn | done | **浙大百事通（新址）**；CAS 必须登录；七域检索（办事指南/常见问题/学校文件/规范性文件/资讯/通讯录/全部）；旧 s.zju 已 502 |
| s.zju.edu.cn | blocked | 旧版百事通已 502（应用层故障）；继任 s1.zju.edu.cn（端点相同、需登录） |
| zju-notices | done | **学院/部处通知统一聚合**（合并 colleges，63 站：47 可达 + 15 内网需 VPN）；390 条 / 近 7 天 15 条 / 0 失败；日期锚点解析 + URL 兜底 |
| www.math.zju.edu.cn | done | 数学学院十个公开通知栏首屏；两栏「信息公告」按父栏目区分；两栏目录别名不一致未开放 |
| www.cse.zju.edu.cn | done | 控制学院五个公开通知栏首屏（各 20 条）；HTTPS 拒绝，仅 HTTP，父/子面包屑同校验 |
| www.psych.zju.edu.cn | done | 心理系四个公开通知栏首屏（各 20 条）；HTTPS 拒绝，仅 HTTP，用 p.title 栏目链接校验 |
| www.som.zju.edu.cn | done | 管理学院通知（更多>>） |
| www.phs.zju.edu.cn | done | 公共卫生学院八个公开通知栏首屏；末项＋大类名＋标题三重校验；两条别名不一致未开放 |
| www.soaa.zju.edu.cn | done | 艺术与考古学院十二个公开通知栏首屏；同名栏按父级区分 |
| opt.zju.edu.cn | done | 光电学院八个公开通知栏首屏；三重校验；三栏同名「通知公告」 |
| ic.zju.edu.cn | done | 集成电路学院九个公开通知栏首屏；position 全链路＋h3 大类校验；两条别名不一致未开放 |
| www.cmic.zju.edu.cn | done | 传媒与国际文化学院通知（学院动态） |
| mse.zju.edu.cn | done | 材料学院十一个公开通知栏首屏；col_path 全链路＋大类名校验；/50918 为容器页 |
| www.isee.zju.edu.cn | done | 信电学院七个公开通知栏首屏；「您的位置」末项＋标题校验；三条别名不一致未开放 |
| oc.zju.edu.cn | done | 海洋学院官网 oc 两个公开通知栏首屏；weizhi＋父栏目＋自报地址 |
| gs.zju.edu.cn | done | 地球科学学院十个公开通知栏首屏；三重校验；两条未列路径仅作旁证 |
| ai.zju.edu.cn | done | 人工智能学院通知（招生通知） |
| www.xgb.zju.edu.cn | done | 学工部通知（学风建设） |
| www.ced.zju.edu.cn | done | 教育学院十二个公开通知栏首屏；四栏同名「信息公告」按父级区分 |
| icsr.zju.edu.cn | done | 网安学院一个公开通知栏首屏；col_path＋大类名＋h2；/xsjl 别名不一致 |
| www.caefs.zju.edu.cn | done | 生物系统工程与食品科学学院通知（师资队伍） |
| saa.zju.edu.cn | done | 航空航天学院通知（通知公告） |
| www.philosophy.zju.edu.cn | done | 哲学学院十二个公开通知栏首屏；三栏同名「最新通知」按完整层级区分 |
| marx.zju.edu.cn | done | 马克思主义学院十二个公开通知栏首屏；三栏同名「最新通知」按父级区分 |
| bms.zju.edu.cn | done | 基础医学系一个公开通知栏首屏；list-top_pos＋大类名＋titl；/85097 别名不一致 |
| www.cec.zju.edu.cn | done | 经济学院六个公开通知栏首屏（各 10 条）；父子栏目同校验，/xssz/ 默认展示子栏 |
| www.neuroscience.zju.edu.cn | done | 脑科学与脑医学系六个公开通知栏首屏；list-top_pos 全链路＋titl 校验；日期两段拼合 |
| www.cbeis.zju.edu.cn | done | 生仪学院六个公开通知栏首屏；dc-weizhi 全链路＋m1 h2 大类校验 |
| www.cst.zju.edu.cn | done | 软件学院四个公开通知栏首屏；col_path 末项＋Column_Anchor 校验；/36192 单篇文章页 |
| ygb.zju.edu.cn | done | 研工部两个公开通知栏首屏；position_dqwz 链路＋Column_Anchor 校验 |
| ai.office.zju.edu.cn | done | 人工智能学院五个公开通知栏首屏；Tailwind 模板按面包屑块＋h2 校验 |
| bmsoa.zju.edu.cn | done | 基础医学系通知（内部公示）；**直连 502，需 WebVPN**；**需 WebVPN** |
| che.cn.zju.edu.cn | done | 化工学院九个公开通知栏首屏；crumbs 链路＋标题＋大类名三重校验 |
| cspo.zju.edu.cn | done | 计算机学院四个公开通知栏首屏；末项路径＋大类名校验；四条别名不一致未开放 |
| doe-oa.zju.edu.cn | done | 能源工程学院六个公开通知栏首屏；三重校验；三条别名不一致未开放 |
| ee.office.zju.edu.cn | done | 电气学院九个公开通知栏首屏；末项路径＋大类名校验；两条别名不一致未开放 |
| office.cab.zju.edu.cn | done | 农学院五个公开通知栏首屏；col_path 末项＋大类名＋h2 校验；三条别名不一致未开放 |
| office.cas.zju.edu.cn | done | 动物科学学院六个公开通知栏首屏；三重校验；/15889 多子栏容器页未开放 |
| office.chem.zju.edu.cn | done | 化学系十二个公开通知栏首屏；大类＋左侧选中项＋标题三重校验 |
| office.cmic.zju.edu.cn | done | 传媒与国际文化学院十一个公开通知栏首屏；cg-position 全链路＋大类名校验 |
| office.ls.zju.edu.cn | done | 历史学院九个公开通知栏首屏；含默认子栏与父子同路径情形 |
| office.polymer.zju.edu.cn | done | 高分子系五个公开通知栏首屏；position 全链路＋banner 大类校验；/sjjx 无日期列表 |
| saa.office.zju.edu.cn | done | 航空航天学院十个公开通知栏首屏；末项路径＋大类名校验；两条别名不一致未开放 |
| www.cls.office.zju.edu.cn | done | 生命科学学院七个公开通知栏首屏；breadcrumb 末项＋h3 校验；四条别名不一致未开放 |
| zju-colleges | done | 学院站群扫描（63 站协议矩阵与真实 IP）；**通知抓取已并入 zju-notices 的 crawler-merged.mjs** |
| zju-ebook | blocked | 电子书双源（SS360 + 超星）；**按校园网 IP 认证**，本机进不去；协议已抄录待 WebVPN |
| yjsy.zju.edu.cn | done | 研究生院；CAS→JWT（X-Access-Token 头，纯 node:https 可用）；**教学日历 14 节精确起止**；课表（研究生身份才有数据） |
| tyys.zju.edu.cn | done | 公开场馆使用规定与 APP预约说明；新预约后台匿名业务 400，实时余量/本人订单未验证 |
| sztz.zju.edu.cn | done | 公开项目/活动/通知；可单页匿名读取活动和通知，个人成绩单/认定记录待授权 |
| zjuem.zju.edu.cn | done | 浙大邮件系统 Webmail；zjuem 与 mail 两域名同一套（21,815B/21,813B）；独立邮箱账号非 CAS；SMTP 994 |
| zjutw.zju.edu.cn | done | 校团委公开 Webplus；八个栏目 HTTPS .psp 首屏 200，通知总栏第 2 页与同站正文均实测；免登录、无批量抓取。 |
| www.grs.zju.edu.cn | done | 研究生院门户全部公告：公开 HTTP 单页 14 条；HTTPS 443 连接拒绝（robots 样本）。与 yjsy 教务无关。 |
| cdn.jsdelivr.net | done | holiday-cn 公共年度 JSON；2026/2027 国务院公告对照和离线查询，不是浙大校历 |
| me.zju.edu.cn | done | 机械学院六个公开通知栏首屏（各 14 条）；HTTPS 拒绝，仅 HTTP，父子栏目同校验 |
| www.spa.zju.edu.cn | done | 公共管理学院十二个公开通知栏首屏；四栏同名「最新通知」按完整层级区分 |
| www.ghls.zju.edu.cn | done | 光华法学院十二个公开通知栏首屏；bread_crumb 全链路＋横幅栏目名校验 |
| www.ccea.zju.edu.cn | done | 建筑工程学院十个公开通知栏首屏；col_path 全链路＋大类名校验 |
| www.sis.zju.edu.cn | done | 外国语学院八个公开通知栏首屏；dqwzdd 全链路＋标题校验；两条别名不一致未开放 |
| oca.zju.edu.cn | done | 海洋学院十个公开通知栏首屏；weizhi 标题＋父栏目＋页面自认地址校验 |
| www.cas.zju.edu.cn | done | 动物科学学院四个公开通知栏首屏；「当前位置」全链路＋侧栏 h3；日期两种形态 |
| literature.zju.edu.cn | done | 文学院三个公开通知栏首屏；无面包屑，按左侧导航选中项＋大类名校验 |
| www.doe.zju.edu.cn | done | 能源学院官网两个公开通知栏首屏；col_path 末项＋Column_Anchor；/74364 与 /74397 同内容取后者 |
| che.zju.edu.cn | done | 化工学院官网 /checn/ 两个公开通知栏首屏；与 che.cn 是不同 host |
| physics.zju.edu.cn | done | 物理学院两个公开通知栏首屏；weizhi＋导航选中项＋侧栏 h3；日期两段拼合 |
| www.cs.zju.edu.cn | done | 计算机学院官网 csen 子站两个公开通知栏首屏；col_path＋大类名＋h2 |
| ls.zju.edu.cn | done | 历史学院 ls 一个公开通知栏首屏；两级面包屑＋侧栏 h3；首屏全为公众号外链 |
| polymer.zju.edu.cn | done | 高分子学系独立站：/36748 渲染默认子栏 /36753，标别名不一致不开放 |
