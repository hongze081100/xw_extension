import installInjectBridge from './bridge';

function injectScript(path: string, searchParams?: URLSearchParams) {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("" + path) + (searchParams ? "?" + new URLSearchParams(searchParams) : "");
  script.type = "module";
  script.charset = "UTF-8";
  script.onload = function () {};
  (document.head || document.documentElement).appendChild(script);
}

function injectCSS(path: string) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL(path);
  (document.head || document.documentElement).appendChild(link);
}

const injectBridge = installInjectBridge();

injectCSS("assets/content.css");
injectScript("assets/content.js");

void injectBridge;
