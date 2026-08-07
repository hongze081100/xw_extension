// 动态向页面注入 script 标签（通过 chrome.runtime.getURL 获取扩展内资源）
const injectScript = (path: string, searchParams?: URLSearchParams) => {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("" + path) + (searchParams ? "?" + new URLSearchParams(searchParams) : "");
  script.type = "module";
  script.charset = "UTF-8";
  script.onload = function () {};
  (document.head || document.documentElement).appendChild(script);
};

// 注入 content.js 对应的 CSS 文件
const injectCSS = (path: string) => {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL(path);
  (document.head || document.documentElement).appendChild(link);
};

injectCSS("assets/content.css");  
injectScript("assets/content.js");

