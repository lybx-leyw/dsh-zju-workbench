/**
 * 工具参数的校验小件 —— 读写工具共用。
 *
 * # 为什么单独一层
 *
 * 「必填字符串」「可选整数」「枚举取值」这三件事，每个工具包都会写一遍。
 * 写第二遍时它们就开始漂：一个包把空串当「没给」，另一个当成错误；
 * 一个包接受 `"3"`，另一个只接受 `3`。漂了不会报错，只会让模型在两个
 * 同名参数上得到相反的反馈。
 *
 * 所以这里只放**判据**，不放任何具体工具的知识。
 *
 * # 与 `WriteRejected` 的关系
 *
 * 参数错误不是「用户不批」，是「调用方说错了」。两者混成一个码会让模型
 * 在参数写错时去请求用户批准，或者在用户拒绝时重试参数。
 */

/** 参数错误。`code` 稳定，下游按码分派。 */
export const inputError = (message) => Object.assign(new Error(message), { code: 'INPUT' });

/** 必填字符串。 */
export const str = (value, name, { max = 200 } = {}) => {
  if (typeof value !== 'string' || !value.trim()) throw inputError(`需要 ${name}`);
  if (value.length > max) throw inputError(`${name} 过长（上限 ${max} 字）`);
  return value.trim();
};

/** 可选字符串。 */
export const optStr = (value, name, options) => (value === undefined ? undefined : str(value, name, options));

/** 可选布尔。 */
export const optBool = (value, name) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw inputError(`${name} 需要 true 或 false`);
  return value;
};

/** 可选整数（含下界与上界）。 */
export const optInt = (value, name, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw inputError(`${name} 需要整数`);
  if (value < min || value > max) throw inputError(`${name} 应在 ${min}–${max} 之间`);
  return value;
};

/**
 * 取一个 source 服务；没有就说清要装哪个包。
 *
 * 缺包是安装问题，模型据此才知道该对用户说什么 —— 笼统的「服务不可用」
 * 只会让它反复重试。
 *
 * @param services - 服务表（`{ [key]: service }`）。
 * @param key - 服务名。
 * @param pkg - 对应的包名（报错时用）。
 * @returns 服务对象。
 */
export function serviceLookup(services, key, pkg) {
  const service = services[key];
  if (!service) {
    throw Object.assign(
      new Error(`这个动作需要 ${pkg}（服务 ${key}），但它没有装配。请先启用那个数据源包。`),
      { code: 'SERVICE_MISSING', service: key },
    );
  }
  return service;
}

/** 去掉值为 `undefined` 的键：source 的「不传就用默认」不该被显式的 undefined 走一遍。 */
export const defined = (value) => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== undefined),
);
