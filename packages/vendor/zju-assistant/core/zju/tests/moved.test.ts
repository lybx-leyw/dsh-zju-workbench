/**
 * 学校搬了家的旧地址换成现在的地址（lib/core/moved.ts，表在 moved.json）：整个地址、一段文字里的、命令结果里的。不联网。
 */
import test from "node:test";
import assert from "node:assert/strict";

const { currentUrl, currentText, currentAddresses } = await import("../lib/core/moved.ts");
const { envelope } = await import("../lib/core/output.ts");

const NOW = "https://sztz.zju.edu.cn/dekt/";

test("老素拓网的地址换成现在的平台；别的地址不动", () => {
  for (const old of ["http://www.youth.zju.edu.cn/sztz", "https://www.youth.zju.edu.cn/sztz/", "www.youth.zju.edu.cn/sztz", "http://WWW.YOUTH.ZJU.EDU.CN/sztz/index.php?id=3", "http://www.qzlake.zju.edu.cn/", "www.qzlake.zju.edu.cn/a/b"]) {
    assert.equal(currentUrl(old), NOW, old);
  }
  // 团委的旧域名学校自己会跳到新网站，不归这里管；名字只是前一截相同的也不是。
  for (const other of ["http://www.youth.zju.edu.cn/", "http://www.youth.zju.edu.cn/sztzabc", "https://zjutw.zju.edu.cn/tzgg/list.htm", "https://sztz.zju.edu.cn/dekt/", "mailto:a@zju.edu.cn", "不是地址"]) {
    assert.equal(currentUrl(other), other, other);
  }
});

test("文字里的旧地址换掉，前后的字和标点不动", () => {
  assert.equal(currentText("获奖学生可在素拓网（ www.youth.zju.edu.cn/sztz ）项目库中进行申请。"), `获奖学生可在素拓网（ ${NOW} ）项目库中进行申请。`);
  assert.equal(currentText("登录素拓网（http://www.youth.zju.edu.cn/sztz/index.php?a=1）后申请"), `登录素拓网（${NOW}）后申请`);
  assert.equal(currentText("见http://www.youth.zju.edu.cn/sztz，以及 www.qzlake.zju.edu.cn。"), `见${NOW}，以及 ${NOW}。`);
  assert.equal(currentText("网址www.youth.zju.edu.cn/sztz项目库"), `网址${NOW}项目库`);
  // 不是旧地址的照原样：团委旧域名的别的页面、只是长得像的。
  for (const same of ["团委网站 www.youth.zju.edu.cn 的通知", "http://www.youth.zju.edu.cn/sztzabc", "mail.www.qzlake.zju.edu.cn.example.com", "没有地址的一句话"]) assert.equal(currentText(same), same);
});

test("命令的结果里，哪一层的字符串都换；数字、空值照旧", () => {
  const data = { notices: [{ title: "二课记点", text: "在素拓网（www.youth.zju.edu.cn/sztz）申请", links: [{ text: "素拓网", url: "http://www.youth.zju.edu.cn/sztz/" }], count: 2, extra: null }] };
  assert.deepEqual(currentAddresses(data), { notices: [{ title: "二课记点", text: `在素拓网（${NOW}）申请`, links: [{ text: "素拓网", url: NOW }], count: 2, extra: null }] });
  assert.equal(envelope("notice", "list", data).data.notices[0]!.links[0]!.url, NOW);
});
