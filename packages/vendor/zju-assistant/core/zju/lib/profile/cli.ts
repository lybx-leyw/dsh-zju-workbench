/** profile module CLI; business calls stay inside this module. */
import { command, type Command } from "../core/command.ts";
import { publicProfile } from "./profile.ts";

export const profileCommands: Record<string, Command> = {
  show: command("显示账号和学籍；密码只显示是否已填", {}, async () => publicProfile(), "local"),
};
