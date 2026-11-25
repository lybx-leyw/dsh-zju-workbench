# 动物科学学院官网（www.cas.zju.edu.cn）

- 站点走公开 HTTP；内容在 /caschinese/ 子站。

## 四个精确公开栏目（2026-11-22）

- http://www.cas.zju.edu.cn/caschinese/jxxz/list.htm：人才培养 › 教学相长（大类 人才培养），14 条，外链 0；CMS 声明 69 条 / 5 页
- http://www.cas.zju.edu.cn/caschinese/15939/list.htm：人才培养 › 研究生教育 › 通知公告（大类 人才培养），14 条，外链 0；CMS 声明 86 条 / 7 页
- http://www.cas.zju.edu.cn/caschinese/pxtz/list.htm：科学研究 › 公用平台 › 培训通知（大类 科学研究），9 条，外链 0；CMS 声明 9 条 / 1 页
- http://www.cas.zju.edu.cn/caschinese/xsgz/list.htm：人才培养 › 学生工作（大类 人才培养），14 条，外链 0；CMS 声明 226 条 / 17 页

- 身份：frag=窗口22 的「当前位置」全链路（末项须等于本栏路径）+ frag=窗口24 侧栏 h3 大类名。
- 版面：div.list-card-box > ul.text-list > li.createBg > a.box；标题在 h4，日期有两种形态——time-box 内 date（日）+ month（YYYY-MM）拆分，或 time.btnText 的完整 YYYY-MM-DD。
- 别名不一致：/caschinese/15907 末项自认 /caschinese/15911/，标 identity-mismatch 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.cas.zju.edu.cn /caschinese/xsgz/list.htm --summary。
