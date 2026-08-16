<<<<<<<< HEAD:dist/assets/web-DWxBMwmM.js
import{i as a}from"./main-DUh167mL.js";class i extends a{async canShare(){return typeof navigator>"u"||!navigator.share?{value:!1}:{value:!0}}async share(e){if(typeof navigator>"u"||!navigator.share)throw this.unavailable("Share API not available in this browser");return await navigator.share({title:e.title,text:e.text,url:e.url}),{}}}export{i as ShareWeb};
========
import{s as a}from"./main-Cp-HM2VV.js";class n extends a{async canShare(){return typeof navigator>"u"||!navigator.share?{value:!1}:{value:!0}}async share(e){if(typeof navigator>"u"||!navigator.share)throw this.unavailable("Share API not available in this browser");return await navigator.share({title:e.title,text:e.text,url:e.url}),{}}}export{n as ShareWeb};
>>>>>>>> a6b69a7 (fix(photos): bound the signed-URL lookup so thumbnails fail gracefully):dist/assets/web-B2tuypdg.js
