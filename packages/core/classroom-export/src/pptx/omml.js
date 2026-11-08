/**
 * LaTeX → OMML（Office Math Markup Language），PPTX 里可编辑的原生公式。
 *
 * 源：ref/OpenMAIC/lib/export/latex-to-omml.ts:1-91
 *
 * 上游的管线是 `LaTeX --temml--> MathML --mathml2omml--> OMML --后处理--> PPTX`。
 * 本仓环境里没有 `mathml2omml`（也不新增 npm 依赖），因此**第一段照搬**（temml，
 * 仓库 node_modules 已有），第二段改成本文件内的 MathML→OMML 映射：
 *
 *   mrow/msup/msub/msubsup/mfrac/msqrt/mroot/mtable/mover/munder → m:oMath 子节点
 *   mi/mn/mo/mtext/mspace                                    → m:r + m:t 文本 run
 *
 * 约定与上游一致：只覆盖 temml 会产出的结构，遇到不认识的标签就**解包**（保留子
 * 内容），mspace 保留空白；整段无内容则返回 null，由调用方回落到 SVG 路径或跳过。
 * 上游后处理 postProcessOmml 逐行照搬（去掉 DOCX 专属 xmlns:w / `<w:rPr>`，注入
 * Cambria Math 的 `<a:rPr>`）—— 这些是 PowerPoint 能否打开幻灯片的硬条件。
 */

import { toAST } from './html-parser.js';

/** 源：latex-to-omml.ts:12-20 */
function stripUnsupportedMathML(mathml) {
  let result = mathml;
  for (const tag of ['mpadded']) {
    result = result.replace(new RegExp(`<${tag}[^>]*>`, 'g'), '');
    result = result.replace(new RegExp(`</${tag}>`, 'g'), '');
  }
  return result;
}

/** 源：latex-to-omml.ts:26-34 */
function buildMathRPr(szHundredths) {
  const szAttr = szHundredths ? ` sz="${szHundredths}"` : '';
  return (
    `<a:rPr lang="en-US" i="1"${szAttr}>` +
    '<a:latin typeface="Cambria Math" panose="02040503050406030204" charset="0"/>' +
    '<a:cs typeface="Cambria Math" panose="02040503050406030204" charset="0"/>' +
    '</a:rPr>'
  );
}

/** 源：latex-to-omml.ts:46-69 */
function postProcessOmml(omml, szHundredths) {
  let result = omml;
  const rpr = buildMathRPr(szHundredths);

  // DOCX 专属 xmlns:w，以及 <p:sld> 已经声明过的 xmlns:m，PPTX 里都必须去掉。
  result = result.replace(/ xmlns:w="[^"]*"/g, '');
  result = result.replace(/ xmlns:m="[^"]*"/g, '');

  // DOCX 专属 <w:rPr>（含 <w:b/> / <w:i/>）：slide part 里没有 w: 前缀声明，
  // 留着会让整页 XML 不合法，PowerPoint 直接拒绝打开。
  result = result.replace(/<w:rPr\/>|<w:rPr>[\s\S]*?<\/w:rPr>/g, '');

  // 在 <m:r> 内、<m:t> 之前插入 <a:rPr>；有 <m:rPr> 时按 schema 顺序排在它之后。
  result = result.replace(/<m:r>(\s*)<m:t/g, `<m:r>$1${rpr}$1<m:t`);
  result = result.replace(/(<\/m:rPr>)(\s*)<m:t/g, `$1$2${rpr}$2<m:t`);

  // 空的 <m:ctrlPr/>（两种写法）补上 <a:rPr>。
  result = result.replace(/<m:ctrlPr\/>/g, `<m:ctrlPr>${rpr}</m:ctrlPr>`);
  result = result.replace(/<m:ctrlPr><\/m:ctrlPr>/g, `<m:ctrlPr>${rpr}</m:ctrlPr>`);

  return result;
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeXml(value) {
  return String(value).replace(/[&<>"]/g, (char) => XML_ESCAPES[char]);
}

function textOf(node) {
  if (node.type === 'text') return node.content;
  if (node.type !== 'element') return '';
  return node.children.map(textOf).join('');
}

function children(node) {
  return node.type === 'element' ? node.children : [];
}

function elements(node) {
  return children(node).filter((child) => child.type === 'element');
}

function run(text) {
  if (!text) return '';
  return `<m:r><m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`;
}

/** `<m:e>` 里不能是空串，否则部分阅读器把整个公式当成空。 */
function wrap(tag, content) {
  return `<m:${tag}>${content || run('')}</m:${tag}>`;
}

/**
 * MathML 节点 → OMML。任何未知标签都解包（保留子内容），这样 temml 新增的
 * 排版包装（<mstyle>、<mpadded>、<menclose> …）不会让整条公式失败。
 */
function convertNode(node) {
  if (node.type === 'text') return /^\s*$/.test(node.content) ? '' : run(node.content);
  if (node.type !== 'element') return '';
  switch (node.tagName) {
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'menclose':
    case 'mphantom':
    case 'merror':
      return children(node).map(convertNode).join('');
    case 'semantics': {
      // 只要第一个"真"子树：后面是 annotation / annotation-xml。
      const first = elements(node).find(
        (child) => child.tagName !== 'annotation' && child.tagName !== 'annotation-xml',
      );
      return first ? convertNode(first) : '';
    }
    case 'annotation':
    case 'annotation-xml':
      return '';
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms':
      return run(textOf(node));
    case 'mspace':
      return run(' ');
    case 'msup': {
      const [base, sup] = elements(node);
      return `<m:sSup>${wrap('e', base ? convertNode(base) : '')}${wrap(
        'sup',
        sup ? convertNode(sup) : '',
      )}</m:sSup>`;
    }
    case 'msub': {
      const [base, sub] = elements(node);
      return `<m:sSub>${wrap('e', base ? convertNode(base) : '')}${wrap(
        'sub',
        sub ? convertNode(sub) : '',
      )}</m:sSub>`;
    }
    case 'msubsup': {
      const [base, sub, sup] = elements(node);
      return `<m:sSubSup>${wrap('e', base ? convertNode(base) : '')}${wrap(
        'sub',
        sub ? convertNode(sub) : '',
      )}${wrap('sup', sup ? convertNode(sup) : '')}</m:sSubSup>`;
    }
    case 'mfrac': {
      const [num, den] = elements(node);
      return `<m:f>${wrap('num', num ? convertNode(num) : '')}${wrap(
        'den',
        den ? convertNode(den) : '',
      )}</m:f>`;
    }
    case 'msqrt':
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${wrap(
        'e',
        children(node).map(convertNode).join(''),
      )}</m:rad>`;
    case 'mroot': {
      const [base, index] = elements(node);
      return `<m:rad>${wrap('deg', index ? convertNode(index) : '')}${wrap(
        'e',
        base ? convertNode(base) : '',
      )}</m:rad>`;
    }
    case 'mtable':
      return `<m:m>${elements(node)
        .map((row) => `<m:mr>${elements(row).map((cell) => wrap('e', convertNode(cell))).join('')}</m:mr>`)
        .join('')}</m:m>`;
    case 'mtr':
      return `<m:mr>${elements(node).map((cell) => wrap('e', convertNode(cell))).join('')}</m:mr>`;
    case 'mtd':
      return wrap('e', children(node).map(convertNode).join(''));
    case 'mover': {
      const [base, over] = elements(node);
      return `<m:limUpp>${wrap('e', base ? convertNode(base) : '')}${wrap(
        'lim',
        over ? convertNode(over) : '',
      )}</m:limUpp>`;
    }
    case 'munder': {
      const [base, under] = elements(node);
      return `<m:limLow>${wrap('e', base ? convertNode(base) : '')}${wrap(
        'lim',
        under ? convertNode(under) : '',
      )}</m:limLow>`;
    }
    case 'munderover': {
      const [base, under, over] = elements(node);
      const upper = `<m:limUpp>${wrap('e', base ? convertNode(base) : '')}${wrap(
        'lim',
        over ? convertNode(over) : '',
      )}</m:limUpp>`;
      return `<m:limLow>${wrap('e', upper)}${wrap('lim', under ? convertNode(under) : '')}</m:limLow>`;
    }
    default:
      return children(node).map(convertNode).join('');
  }
}

/** MathML 字符串 → `<m:oMath>` 片段（未做 PPTX 后处理）。 */
export function mathmlToOmml(mathml) {
  const tree = toAST(mathml);
  const math = tree.find((node) => node.type === 'element' && node.tagName === 'math');
  const root = math ?? { type: 'element', tagName: 'math', attributes: [], children: tree };
  const body = elements(root).map(convertNode).join('');
  if (!body) return null;
  return `<m:oMath>${body}</m:oMath>`;
}

let temmlPromise;

async function loadTemml() {
  if (!temmlPromise) {
    temmlPromise = import('temml').then(
      (module) => module.default ?? module,
      () => null,
    );
  }
  return temmlPromise;
}

/**
 * 源：latex-to-omml.ts:71-91 —— 同样的入口与失败语义（返回 null，不抛）。
 *
 * 与上游的唯一差别：MathML→OMML 由本文件的映射完成（见文件头），因此
 * `@param` 之外还额外接受 `options`（测试用来注入固定 MathML）。
 */
export async function latexToOmml(latex, fontSize, options = {}) {
  try {
    if (typeof latex !== 'string' || !latex.trim()) return null;
    let mathml = options.mathml;
    if (!mathml) {
      const temml = await loadTemml();
      if (!temml) return null;
      mathml = temml.renderToString(latex, {
        // 与 @openmaic/dsl 的 safeKatexOptions() 同向：不抛、不严格。
        throwOnError: false,
        strict: false,
        displayMode: false,
        xml: true,
      });
    }
    const cleaned = stripUnsupportedMathML(String(mathml));
    const omml = mathmlToOmml(cleaned);
    if (!omml) return null;
    const szHundredths = fontSize ? Math.round(fontSize * 100) : undefined;
    return postProcessOmml(omml, szHundredths);
  } catch {
    return null;
  }
}
