import { defineTranslations } from "@getpaseo/plugin/client";

export const messages = defineTranslations({
  resources: {
    en: {
      reveal: "Show in Folder",
      open: "Open",
      copyPath: "Copy Path",
      copyImage: "Copy Image",
      notFound: "File not found",
      noBase: "Workspace folder unknown",
      failed: "Could not open",
    },
    "zh-CN": {
      reveal: "在文件夹中显示",
      open: "打开",
      copyPath: "复制路径",
      copyImage: "复制图片",
      notFound: "找不到文件",
      noBase: "不知道工作区目录",
      failed: "无法打开",
    },
  },
});
