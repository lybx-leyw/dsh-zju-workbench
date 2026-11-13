export const inject = ['zwClassroom', 'zwParser', 'zwLecture', 'zwQuiz', 'zwNotes', 'zwKnowledge'];
export async function apply(ctx) {
  const source = ctx.zwClassroom;
  if (!source || await source.getCurrentUser() !== null) throw new Error('Fresh host profile must expose an unauthenticated classroom service');
  console.log('ZW_CLASSROOM_HOST_READY');
  if (typeof ctx.zwParser?.parseClassroom !== 'function') throw new Error('Parser must be injected by the product profile');
  console.log('ZW_PARSER_HOST_READY');
  // 两个新插件也必须**在真实宿主里激活过**才算装上：单元测试用的是假 ctx，
  // 而「inject 了一个不存在的服务」只有在真宿主里才会表现为永远 pending。
  if (typeof ctx.zwLecture?.assemble !== 'function') throw new Error('Lecture assembler must be injected by the product profile');
  // 习坎的全文润色是**新增**的能力：装配器有它，才说明「成稿」这条链是完整的。
  // （旧的 zwFinalPass 自由发挥服务已整包删除，不再检查。）
  if (typeof ctx.zwLecture?.polish !== 'function') throw new Error('Lecture assembler must expose polish() for the final full-text pass');
  console.log('ZW_LECTURE_HOST_READY');
  // 断言各自**真实存在**的表面：quiz 的 `reviewQueue` 是 getter（返回数组），
  // 对它做 typeof === 'function' 会误报未接入。
  if (typeof ctx.zwQuiz?.generate !== 'function' || typeof ctx.zwQuiz?.store !== 'object') throw new Error('Quiz service must be injected by the product profile');
  if (typeof ctx.zwNotes?.getOrEmpty !== 'function') throw new Error('Notes service must be injected by the product profile');
  if (typeof ctx.zwKnowledge?.put !== 'function') throw new Error('Knowledge store must be injected by the product profile');
  console.log('ZW_STORE_HOST_READY');
}
