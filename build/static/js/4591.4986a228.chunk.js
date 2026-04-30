"use strict";(self.webpackChunkkeiretsuproject=self.webpackChunkkeiretsuproject||[]).push([[4591],{54366:(e,n,t)=>{t.d(n,{A:()=>d});var a=t(65043),r=t(27879),o=t(70579);const i=e=>{let{icon:n,label:t,count:a,title:r,preview:i,onClick:l}=e;return(0,o.jsx)(o.Fragment,{children:(0,o.jsxs)("div",{className:"knowledge__article",onClick:l,children:[(0,o.jsx)("div",{className:"knowledge__article-cat",children:t}),(0,o.jsx)("h4",{className:"knowledge__article-title",children:r}),(0,o.jsx)("p",{className:"knowledge__article-preview",children:i})]})})};var l=t(50423);const s=e=>{let{isOpen:n,onClose:t,category:r,article:i,articles:s,onArticleSelect:d,icon:c}=e;const[p,u]=(0,a.useState)(i),[m,x]=(0,a.useState)(""),[h,g]=(0,a.useState)(s),f=[{name:"LinkedIn",icon:()=>(0,o.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,o.jsx)("path",{d:"M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"})}),url:(e,n)=>"https://www.linkedin.com/sharing/share-offsite/?url="+n},{name:"X",icon:()=>(0,o.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,o.jsx)("path",{d:"M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"})}),url:(e,n)=>"https://twitter.com/intent/tweet?text="+e+"&url="+n},{name:"Reddit",icon:()=>(0,o.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,o.jsx)("path",{d:"M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 000-.462.342.342 0 00-.462 0c-.545.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.205-.095z"})}),url:(e,n)=>"https://www.reddit.com/submit?url="+n+"&title="+e},{name:"Quora",icon:()=>(0,o.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,o.jsx)("path",{d:"M12.738 18.587c-.926-1.644-2.086-3.32-4.082-3.32-.497 0-1.025.109-1.49.344l-.65-1.3c.893-.737 2.117-1.177 3.553-1.177 2.467 0 3.86 1.259 4.918 2.85.364-1.049.564-2.285.564-3.737 0-5.112-2.237-8.476-6.294-8.476-4.034 0-6.294 3.364-6.294 8.476 0 5.09 2.26 8.398 6.294 8.398 1.318 0 2.45-.348 3.481-1.058zM12.2 24C5.484 24 0 18.627 0 12S5.484 0 12.2 0C18.917 0 24 5.373 24 12s-5.084 12-11.8 12z"})}),url:(e,n)=>"https://www.quora.com/share?url="+n},{name:"Discord",icon:()=>(0,o.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,o.jsx)("path",{d:"M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1569 2.4189z"})}),url:(e,n)=>"https://discord.com/channels/@me"},{name:"Slack",icon:()=>(0,o.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,o.jsx)("path",{d:"M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z"})}),url:(e,n)=>"https://slack.com/"},{name:"WeChat",icon:()=>(0,o.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,o.jsx)("path",{d:"M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm3.68 4.025c-3.655 0-6.622 2.467-6.622 5.51 0 3.044 2.967 5.51 6.622 5.51.424 0 .85-.044 1.271-.118a.67.67 0 01.552.076l1.47.861a.251.251 0 00.129.042c.12 0 .224-.103.224-.228 0-.055-.024-.109-.037-.163l-.301-1.144a.457.457 0 01.165-.514C21.11 19.158 22 17.573 22 15.526c0-3.043-2.967-5.51-6.622-5.51h-.1zm-2.382 2.725c.496 0 .898.407.898.911a.904.904 0 01-.898.91.904.904 0 01-.898-.91c0-.504.402-.911.898-.911zm4.766 0c.496 0 .898.407.898.911a.904.904 0 01-.898.91.904.904 0 01-.898-.91c0-.504.402-.911.898-.911z"})}),url:(e,n)=>"https://web.wechat.com/"},{name:"Weibo",icon:()=>(0,o.jsx)("svg",{viewBox:"0 0 24 24",width:"16",height:"16",fill:"currentColor",children:(0,o.jsx)("path",{d:"M10.098 20.323c-3.977.391-7.414-1.406-7.672-4.02-.259-2.609 2.759-5.047 6.74-5.441 3.979-.394 7.413 1.404 7.671 4.018.259 2.6-2.759 5.049-6.737 5.439l-.002.004zM16.26 8.882c-.21-.664-.876-.99-1.49-.726-.609.266-.93.94-.719 1.596.213.663.88.987 1.488.722.612-.265.932-.939.72-1.592zm1.597-1.147c-.591-1.876-2.462-2.782-4.202-2.024-1.718.748-2.622 2.794-2.022 4.632.593 1.86 2.472 2.772 4.198 2.028 1.74-.748 2.632-2.788 2.026-4.636zM20.2 7.17c-1.098-3.49-4.56-5.168-7.797-3.753-3.197 1.397-4.865 5.19-3.744 8.448a.15.15 0 00.056.075c1.106 3.47 4.554 5.153 7.783 3.76 3.19-1.375 4.858-5.16 3.752-8.435-.012-.032-.032-.064-.05-.095zM4.452 14.2c-.027-.156-.147-.308-.38-.267-.237.04-.358.209-.334.376.024.16.15.31.377.27.237-.039.36-.214.337-.38zm-.69.55c-.09-.15-.273-.218-.413-.154-.136.065-.177.218-.09.37.09.15.271.218.41.158.14-.06.183-.216.093-.374zM20.74 4.157c-1.463-1.857-3.684-2.672-5.577-2.37a.46.46 0 00-.382.528.457.457 0 00.527.382c1.55-.248 3.374.41 4.583 1.943 1.21 1.533 1.46 3.49.825 5.046a.459.459 0 00.258.593.456.456 0 00.594-.258c.783-1.916.48-4.004-.828-5.864z"})}),url:(e,n)=>"https://service.weibo.com/share/share.php?url="+n+"&title="+e}];if((0,a.useEffect)((()=>{if(""===m.trim())g(s);else{const e=s.filter((e=>e.question.toLowerCase().includes(m.toLowerCase())));g(e)}}),[m,s]),(0,a.useEffect)((()=>{x(""),g(s)}),[r,s]),(0,a.useEffect)((()=>{h.length>0&&!h.find((e=>e.question===(null===p||void 0===p?void 0:p.question)))&&(u(h[0]),d(h[0]))}),[h]),!n)return null;const v=e=>{u(e),d(e)};return console.log(p.answer),(0,o.jsx)("div",{className:"modal-overlay",onClick:t,children:(0,o.jsx)("div",{className:"modal-content",onClick:e=>e.stopPropagation(),children:(0,o.jsxs)("div",{className:"d-flex flex-column gap-4 p-4",children:[(0,o.jsxs)("div",{className:"d-flex align-items-center border_bottom gap-4 justify-content-between",children:[(0,o.jsxs)("div",{className:"modal-header",children:[(0,o.jsx)("span",{className:"modal-category-icon",children:c}),(0,o.jsx)("span",{className:"modal-category",children:r.name}),(0,o.jsxs)("span",{className:"modal-count",children:[s.length," articles"]})]}),(0,o.jsx)("button",{className:"modal-close",onClick:t,children:"\xd7"})]}),(0,o.jsxs)("div",{className:"d-flex align-items-start gap-0",children:[(0,o.jsxs)("div",{className:"modal-articles-sidebar cust-scroll",children:[(0,o.jsxs)("div",{className:"mb-3 artical-input d-flex align-items-center gap-2 w-100",children:[(0,o.jsx)("div",{className:"artical-icon",children:(0,o.jsx)(l.Mmj,{})}),(0,o.jsx)("input",{type:"text",placeholder:`Filter articles in ${r.name}...`,value:m,onChange:e=>x(e.target.value)})]}),(0,o.jsx)("h4",{children:"Articles in this category"}),(0,o.jsx)("div",{className:"articles-list",children:h.map(((e,n)=>(0,o.jsxs)("button",{className:"article-item "+(p.question===e.question?"active":""),onClick:()=>v(e),children:[(0,o.jsx)("span",{className:"article-number",children:n+1}),(0,o.jsx)("span",{className:"article-title",children:e.question})]},n)))})]}),(0,o.jsxs)("div",{className:"modal-article-content cust-scroll",children:[(0,o.jsxs)("div",{className:"article-header",children:[(0,o.jsx)("h2",{className:"article-ar-title",children:p.question}),(0,o.jsx)("div",{className:"article-share",children:(e=>{const n=encodeURIComponent(window.location.href),t=encodeURIComponent(e+" \u2014 Capavate Education");return f.map(((e,a)=>(0,o.jsx)("a",{className:"share-btn",href:e.url(t,n),target:"_blank",rel:"noopener noreferrer",title:`Share on ${e.name}`,"aria-label":`Share on ${e.name}`,children:e.icon()},a)))})(p.question)})]}),(0,o.jsx)("div",{className:"article-body",children:(e=>{if(!e)return null;const n=e.split(/(?<=\.\s)/),t=Math.ceil(n.length/3),a=[];for(let r=0;r<n.length;r+=t){const e=n.slice(r,r+t).join("");e.trim()&&a.push(e.trim())}return 0===a.length&&e.trim()&&a.push(e.trim()),a.map(((e,n)=>(0,o.jsx)("p",{children:e},n)))})(p.answer)}),p.tags&&p.tags.length>0&&(0,o.jsx)("div",{className:"article-tags",children:p.tags.map(((e,n)=>(0,o.jsxs)("span",{className:"tag",children:["#",e]},n)))}),p.capavate_for_you&&(0,o.jsxs)("div",{className:"capavate-callout",children:[(0,o.jsx)("div",{className:"callout-icon",children:"\u2728"}),(0,o.jsxs)("div",{className:"callout-content",children:[(0,o.jsx)("strong",{children:"Capavate for you"}),(0,o.jsx)("p",{children:p.capavate_for_you})]})]}),(0,o.jsxs)("div",{className:"article-navigation",children:[(0,o.jsx)("button",{className:"nav-btn prev",onClick:()=>{const e=h.findIndex((e=>e.question===p.question));e>0&&v(h[e-1])},disabled:0===h.findIndex((e=>e.question===p.question)),children:"\u2190 Previous Article"}),(0,o.jsx)("button",{className:"nav-btn next",onClick:()=>{const e=h.findIndex((e=>e.question===p.question));e<h.length-1&&v(h[e+1])},disabled:h.findIndex((e=>e.question===p.question))===h.length-1,children:"Next Article \u2192"})]})]})]})]})})})},d=()=>{const[e,n]=(0,a.useState)(null),[t,l]=(0,a.useState)(null),[d,c]=(0,a.useState)(!1),[p,u]=(0,a.useState)([]);console.log("QA_CATEGORIES:",r.i),console.log("QA_ARTICLES:",r.n),console.log("QA_ARTICLES length:",null===r.n||void 0===r.n?void 0:r.n.length),(0,a.useEffect)((()=>{const e=e=>{const n=e.detail;h(n)};return window.addEventListener("openCategoryModal",e),()=>window.removeEventListener("openCategoryModal",e)}),[]);const m={SAFE:"\ud83d\udcc4","Convertible Debt":"\ud83d\udcb5","Preferred Equity":"\u2b50","Common Equity":"\ud83d\udcca",Warrants:"\ud83d\udcdc","Instrument Comparisons":"\u2696\ufe0f","Investor Reporting":"\ud83d\udcc8","Data Room & Due Diligence":"\ud83d\udcc1","Dilution & Ownership Modeling":"\ud83e\uddee","Fundraising Rounds & Process":"\ud83d\ude80","Valuation Fundamentals":"\ud83d\udc8e","Vesting & Equity Compensation":"\u23f3","Governance & Shareholder Rights":"\ud83c\udfdb\ufe0f","M&A, Exits & Liquidity":"\ud83e\udd1d","Angel Investing Fundamentals":"\ud83d\udc7c","Founder-Investor Relationships":"\ud83d\udc9e","Term Sheet Structure and Fundamentals":"\ud83d\udccb"},x={SAFE:"SAFE","Convertible Debt":"Convertible Debt","Preferred Equity":"Preferred Equity","Common Equity":"Common Equity",Warrants:"Warrants","Instrument Comparisons":"Instrument Comparisons","Investor Reporting":"Investor Reporting","Data Room & Due Diligence":"Data Room & Due Diligence","Dilution & Ownership Modeling":"Dilution","Fundraising Rounds & Process":"Fundraising","Valuation Fundamentals":"Valuation","Vesting & Equity Compensation":"Vesting","Governance & Shareholder Rights":"Governance","M&A, Exits & Liquidity":"M&A & Exit","Angel Investing Fundamentals":"Angel Investing","Founder-Investor Relationships":"Founder-Investor Relationships","Term Sheet Structure and Fundamentals":"Term Sheets"},h=e=>{const t=(a=e.name,r.n.filter((e=>e.category===a)));var a;t.length>0&&(n(e),u(t),l(t[0]),c(!0))};return(0,o.jsxs)(o.Fragment,{children:[r.i.slice(0,6).map((e=>{const n=(e=>{const n=r.n.filter((n=>n.category===e));return n.length>0?n[0]:null})(e.name);return(0,o.jsx)(i,{icon:m[e.name]||"\ud83d\udcda",label:x[e.name]||e.name,count:e.count,title:n?n.question:"Explore "+e.name,preview:n?n.answer.substring(0,120)+"...":"",onClick:()=>h(e)},e.name)})),e&&t&&(0,o.jsx)(s,{isOpen:d,onClose:()=>{c(!1),n(null),l(null),u([])},category:e,article:t,articles:p,onArticleSelect:e=>{l(e)},icon:m[e.name]||"\ud83d\udcda"}),(0,o.jsx)("style",{children:'\n         \n:root{\n  --color-bg: #f8f7f4;\n  --color-surface: #ffffff;\n  --color-surface-2: #f4f2ef;\n  --color-surface-offset: #edeae5;\n  --color-divider: #dcd9d4;\n  --color-border: #d0cdc7;\n  --color-text: #1a1714;\n  --color-text-muted: #6b6a66;\n  --color-text-faint: #b0afa9;\n  --color-text-inverse: #f8f7f4;\n  --color-primary: #cc0101;\n  --color-primary-hover: rgb(153, 39, 39);\n  --color-primary-active: rgb(139, 24, 24);\n  --color-primary-highlight: #fae8e6;\n  --color-accent: #0d1b2a;\n  --color-accent-hover: #12263a;\n  --color-gold: #d4a843;\n  --shadow-sm: 0 1px 2px rgba(13, 27, 42, 0.06);\n  --shadow-md: 0 4px 16px rgba(13, 27, 42, 0.09);\n  --shadow-lg: 0 12px 40px rgba(13, 27, 42, 0.13);\n  --shadow-xl: 0 24px 80px rgba(13, 27, 42, 0.16);\n   --text-xs: clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem);\n  --text-sm: clamp(0.875rem, 0.8rem + 0.35vw, 1rem);\n  --text-base: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);\n  --text-lg: clamp(1.125rem, 1rem + 0.75vw, 1.5rem);\n  --text-xl: clamp(1.5rem, 1.2rem + 1.25vw, 2.25rem);\n  --text-2xl: clamp(2rem, 1.2rem + 2.5vw, 3.5rem);\n  --text-3xl: clamp(2.5rem, 1rem + 4vw, 5rem);\n  --text-hero: clamp(3rem, 0.5rem + 7vw, 8rem);\n\n  /* Spacing */\n  --space-1: 0.25rem;\n  --space-2: 0.5rem;\n  --space-3: 0.75rem;\n  --space-4: 1rem;\n  --space-5: 1.25rem;\n  --space-6: 1.5rem;\n  --space-8: 2rem;\n  --space-10: 2.5rem;\n  --space-12: 3rem;\n  --space-16: 4rem;\n  --space-20: 5rem;\n  --space-24: 6rem;\n  --space-32: 8rem;\n\n  /* Radius */\n  --radius-sm: 0.375rem;\n  --radius-md: 0.5rem;\n  --radius-lg: 0.75rem;\n  --radius-xl: 1rem;\n  --radius-2xl: 1.5rem;\n  --radius-full: 9999px;\n\n  /* Transitions */\n  --transition-interactive: 180ms cubic-bezier(0.16, 1, 0.3, 1);\n\n  /* Capavate Brand Palette \u2014 Dark Navy + Crimson Red + Gold */\n  --capavate-navy: #0d1b2a;\n  --capavate-navy-2: #12263a;\n  --capavate-navy-3: #162f47;\n  --capavate-navy-light: #1e3d55;\n  --capavate-red: #c0392b;\n  --capavate-red-hover: #a93226;\n  --capavate-red-light: #e74c3c;\n  --capavate-gold: #d4a843;\n  --capavate-gold-light: #f0c060;\n\n  /* Content widths */\n  --content-narrow: 640px;\n  --content-default: 960px;\n  --content-wide: 1400px;\n\n  /* Fonts */\n  --font-display: "Instrument Serif", Georgia, serif;\n  --font-body: "General Sans", "Helvetica Neue", sans-serif;\n  --font-mono: "JetBrains Mono", monospace;\n}\n/* ===== KNOWLEDGE BASE \u2014 Redesigned with articles ===== */\n.knowledge {\n  background: var(--color-surface-cream);\n}\n.knowledge__header {\n  text-align: center;\n  max-width: 750px;\n  margin-inline: auto;\n  margin-bottom: clamp(var(--space-8), 4vw, var(--space-12));\n}\n.knowledge__showcase {\n  max-width: 1100px;\n  margin-inline: auto;\n}\n.knowledge__stats-row {\n  display: flex;\n  justify-content: center;\n  gap: var(--space-8);\n  margin-bottom: var(--space-10);\n}\n.knowledge__stat-box {\n  text-align: center;\n}\n.knowledge__stat-number {\n  font-family: var(--font-display);\n  font-size: var(--text-2xl);\n  color: var(--color-text);\n  display: block;\n  line-height: 1;\n}\n.knowledge__stat-label {\n  font-size: var(--text-xs);\n  color: var(--color-text-muted);\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.08em;\n  margin-top: var(--space-1);\n  display: block;\n}\n\n/* Article cards */\n.knowledge__articles {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: var(--space-4);\n  margin-bottom: var(--space-8);\n}\n.knowledge__article {\n  background: var(--color-surface);\n  border-radius: var(--radius-xl);\n  padding: var(--space-5);\n  border: 1px solid var(--color-divider);\n  transition:\n    box-shadow 0.3s var(--ease-out),\n    transform 0.3s var(--ease-out);\n  cursor: pointer;\n}\n.knowledge__article:hover {\n  box-shadow: var(--shadow-md);\n  transform: translateY(-2px);\n}\n.knowledge__article-cat {\n  font-size: 10px;\n  font-weight: 700;\n  text-transform: uppercase;\n  letter-spacing: 0.08em;\n  color: var(--color-primary);\n  background: var(--color-primary-light);\n  padding: 3px 10px;\n  border-radius: var(--radius-full);\n  display: inline-block;\n  margin-bottom: var(--space-3);\n}\n.knowledge__article-title {\n  font-weight: 700;\n  font-size: var(--text-sm);\n  color: var(--color-text);\n  line-height: 1.4;\n  margin-bottom: var(--space-2);\n}\n.knowledge__article-preview {\n  font-size: var(--text-xs);\n  color: var(--color-text-muted);\n  line-height: 1.5;\n}\n\n/* Tag cloud */\n.knowledge__tags {\n  display: flex;\n  flex-wrap: wrap;\n  gap: var(--space-2);\n  justify-content: center;\n  margin-bottom: var(--space-8);\n}\n.knowledge__tag {\n  background: var(--color-surface);\n  border: 1px solid var(--color-divider);\n  border-radius: var(--radius-full);\n  padding: var(--space-2) var(--space-4);\n  font-size: var(--text-xs);\n  font-weight: 500;\n  color: var(--color-text-secondary);\n  transition: all 0.2s var(--ease-out);\n  cursor: default;\n}\n.knowledge__tag:hover {\n  background: var(--color-primary-light);\n  border-color: var(--color-primary-subtle);\n  color: var(--color-primary);\n  transform: translateY(-2px);\n  box-shadow: var(--shadow-sm);\n}\n.knowledge__cta {\n  text-align: center;\n}\n\n.important-section {\n  padding: 15px;\n  border: 1px solid #cc0000;\n  border-radius: 10px;\n}\n\n        '})]})}},62837:(e,n,t)=>{t.d(n,{$K:()=>i,CB:()=>s,Cd:()=>f,I0:()=>c,Jq:()=>u,R3:()=>w,dN:()=>h,hJ:()=>g,jh:()=>d,mO:()=>r,mg:()=>l,nj:()=>v,pd:()=>b,uM:()=>m,vE:()=>o,z6:()=>p});var a=t(5464);const r=a.default.div`
  input,
  textarea,
  select,
  a,
  p,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin: 0;
    text-decoration: none;
    outline: none;
    word-break: break-word;
    overflow-wrap: break-word;
  }

  input:focus,
  textarea:focus,
  select:focus {
    outline: none;
    box-shadow: none;
    border-color: inherit;
  }
`,o=a.default.span`
  svg {
    width: 16px;
    height: 16px;
    stroke: #9c9c9c;
    stroke-width: 1.2;
    margin-right: 6px;
    vertical-align: middle;
  }
`,i=(a.default.div`
  .react-datepicker-wrapper {
    display: block;
    width: 100%;
  }

  .react-datepicker__input-container {
    display: block;
    width: 100%;
  }

  input.react-datepicker-ignore-onclickoutside {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 14px;
    outline: none;
    background: #fff;
    color: #333;

    &:focus {
      border-color: #999;
      box-shadow: none;
    }
  }

  /* 🔻 Hide the triangle */
  .react-datepicker__triangle {
    display: none !important;
  }
`,a.default.div`
  margin-bottom: auto;
  padding: 15px 0;
  background: var(--primary);
  border-bottom: 10px solid var(--secondary-color);
  .logo {
    display: inline-block;
    width: 140px;
    img {
      width: 100%;
    }
  }
`,a.default.div`
  display: flex;
  gap: 10px;
  align-items: center;
  svg {
    stroke: #fff;
    stroke-width: 1.2; /* thinner stroke if needed */
  }

  select {
    background: #fff;
    color: #111;
    border: none;
    font-size: 14px;
  }
`,a.default.div`
  display: block;
  height: 100%;
`),l=a.default.div`
  // display: none;

  border-radius: 0px;

  &.active {
    display: block;
  }

  label {
    font-size: 0.9rem;
    font-weight: 500;
    color: #000;
    // text-transform: capitalize;
  }

  input[type="text"],
  input[type="number"],
  input[type="email"],
  input[type="tel"],
  select {
    padding: 6px 10px 6px 35px;
    font-size: 15px;
    height: 37px;
    border: none;
    width: 100%;
    border-radius: 6px;
    background: #00000012;
  }

  textarea {
    padding: 6px 8px 6px 35px;
    font-size: 0.9rem;
    border-bottom: 2px solid #ccc;
    border-top: none;
    border-left: none;
    border-right: none;
    border-radius: 0px;
    width: 100%;
    background: #fff;
  }

  .sbtn {
    border: none;
    border-radius: 10px;
    display: inline-block;
    padding: 8px 20px;
    font-size: 0.9rem;
    width: 100%;
  }

  .nextbtn {
    background: var(--primary);
    color: #fff;

    &:hover {
      background: var(--primary);
    }
  }

  .backbtn {
    background: #111;
    color: #fff;

    &:hover {
      background: #2b2b2b;
    }
  }
`,s=a.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;
  text-transform: uppercase;
  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,d=a.default.div`
  color: var(--black);
  font-size: 30px;
  text-align: start;

  font-weight: 600;

  display: inline-block;

  @media only screen and (max-width: 991.98px) {
    font-size: 26px;
  }
`,c=a.default.div`
  color: var(--black);
  font-size: 14px;

  font-weight: 400;

  display: inline-block;
`,p=a.default.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`,u=(a.default.div`
  display: flex;
  align-items: start;
  gap: 12px;

  input[type="radio"] {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    width: 17px;
    height: 17px;
    border: 2px solid var(--primary);
    border-radius: 50%;
    display: grid;
    place-content: center;
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    background: #fff;
    flex-shrink: 0;
    margin-top: 2px;
  }

  input[type="radio"]::before {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 50%;
    transform: scale(0);
    transition: transform 0.2s ease-in-out;
    background-color: var(--primary);
  }

  input[type="radio"]:checked::before {
    transform: scale(1);
  }

  label {
    font-weight: 500;
    cursor: pointer;
    line-height: 1.4;
    color: var(--dark);
    font-size: 0.9rem;
  }
`,a.default.div`
  > .intl-tel-input.allow-dropdown {
    flex: 1 1 auto;
    width: 1%;
  }
`,a.default.div`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 .flag-container {
    margin-left: 35px;
  }

  &.intl-tel-input.allow-dropdown > .flag-container {
    z-index: 4;
  }
`,a.default.input`
  &.intl-tel-input.allow-dropdown.separate-dial-code.iti-sdc-2 #mobile {
    padding-left: 120px;
  }
`,a.default.div`
  position: relative;

  svg {
    position: absolute;
    z-index: 2;
    top: 9px;
    left: 12px;
    width: 16px; /* smaller width */
    height: 16px; /* smaller height */
    stroke: var(--primary-icon);
    stroke-width: 1.2;
  }
`),m=(a.default.div`
  background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags.png");

  @media only screen and (-webkit-min-device-pixel-ratio: 2),
    only screen and (min--moz-device-pixel-ratio: 2),
    only screen and (-o-min-device-pixel-ratio: 2/1),
    only screen and (min-device-pixel-ratio: 2),
    only screen and (min-resolution: 192dpi),
    only screen and (min-resolution: 2dppx) {
    background-image: url("https://cdnjs.cloudflare.com/ajax/libs/intl-tel-input/12.1.6/img/flags@2x.png");
  }
`,a.default.div`
  .klogo {
    width: 50px;
  }
  .inlogo {
    width: 170px;
    img {
      width: 100%;
    }
  }

  h3 {
    color: #999;
    font-size: 14px;
    font-weight: 500;
  }

  h4 {
    color: var(--primary);
    font-weight: 600;
    font-size: 24px;
  }

  h6 {
    color: #999;
    font-size: 14px;
  }

  p {
    color: #111;
    font-size: 14px;
  }
`),x=(a.default.div`
  background: #fff;
  border-radius: 0px;
  padding: 40px 20px;
  box-shadow: 2px 2px 3px #dddddd;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`,a.default.div`
  &.popup {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    container-type: inline-size;
    container-name: video-gallery;
  }
`,a.default.div`
  display: inline-block;
  margin: 0px;
  transition: all 0.3s ease;
  border: 1px solid #cecece;
  position: relative;
  flex: 1 1 300px;
  max-width: 100%;

  video {
    aspect-ratio: 16/9;
  }

  &:before {
    content: "▶";
    color: white;
    font-size: 35px;
    position: absolute;
    width: 60px;
    height: 60px;
    left: 50%;
    top: 50%;
    text-align: center;
    line-height: 60px;
    transition: all 0.3s ease;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 2;
  }

  &:hover {
    cursor: pointer;
    box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);

    .desc {
      padding-bottom: 20px;
    }
  }

  @container video-gallery (max-width: 800px) {
    flex: 1 1 100%;
  }
`,a.default.button`
  background: none;
  border: none;
  font-size: 35px;
  position: absolute;
  width: 60px;
  height: 60px;
  left: 50%;
  top: 50%;
  text-align: center;
  line-height: 60px;
  transition: all 0.3s ease;
  transform: translate(-50%, -50%);
  z-index: 5;
`,a.default.div`
  transition: all 0.3s ease;
  padding: 10px 10px;
  color: white;
  position: absolute;
  top: 0px;
  box-sizing: border-box;
  left: 0px;
  width: 100%;
  margin-top: 0px;
  font-family: arial;
  font-size: 14px;
  text-align: left;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.1) 0%,
    rgba(0, 0, 0, 0.42) 36%,
    rgb(0, 0, 0) 100%
  );
`,a.default.video`
  background-color: black;
  border: none;
`,a.default.div`
  z-index: 999;
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;

  .overlay {
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(10px);
    position: absolute;
  }

  .vid-show {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: transparent;
    padding: 0px;
    background: none;
    width: 80vw;
  }

  .close {
    font-family: arial;
    font-weight: bold;
    background-color: #111;
    color: white;
    font-size: 20px;
    position: absolute;
    right: -5px;
    top: -5px;
    display: grid;
    place-items: center;
    border-radius: 100px;
    width: 40px;
    height: 40px;
    text-align: center;
    transition: all 0.3s ease;
    cursor: pointer;
    z-index: 888;

    &:hover {
      background-color: rgba(80, 80, 80, 0.8);
    }
  }
`,a.default.div`
  position: relative;
  margin-top: 0px;
  text-align: center;

  video {
    aspect-ratio: 16/9;
    object-fit: cover;
    width: 100%;
  }
`,a.default.button`
  display: grid;
  color: #111;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background-color: rgba(255, 255, 255, 0.8);
  border: none;
  border-radius: 10px;
  width: 40px;
  height: 40px;
  font-size: 20px;
  line-height: 40px;
  padding: 9px;
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 44;

  i {
    height: 20px;
  }

  &:hover {
    background-color: rgb(255, 255, 255);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`),h=((0,a.default)(x)`
  left: -60px;

  @media only screen and (max-width: 991.98px) {
    left: -30px;
  }
`,(0,a.default)(x)`
  right: -60px;

  @media only screen and (max-width: 991.98px) {
    right: -30px;
  }
`,a.default.sup`
  color: var(--primary);
`),g=a.default.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: ${e=>{let{show:n}=e;return n?"flex":"none"}};
  align-items: center;
  justify-content: center;
  z-index: 1000;
`,f=a.default.div`
  background: #fff;
  padding: 2rem;
  border-radius: 8px;
  width: 90%;
  max-width: 400px;
  position: relative;

  input {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 14px;
    color: #333;
    background-color: #fff;
    transition: border 0.3s ease;

    &:focus {
      border-color: #999;
      outline: none;
    }

    &::placeholder {
      color: #aaa;
    }
  }
`,v=a.default.button`
  position: absolute;
  top: -8px;
  right: -8px;
  border: none;
  background: #111;
  color: #fff;
  padding: 0px;
  border-radius: 10px;
  cursor: pointer;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  height: 26px;
`,b=a.default.input`
  display: block;
  width: 100%;
  margin-bottom: 1rem;
  padding: 0.5rem;
  font-size: 0.9rem;
`,w=a.default.button`
  padding: 0.6rem 1.2rem;
  background-color: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
`},86621:(e,n,t)=>{t(65043),t(27879),t(70579)},94372:(e,n,t)=>{t.d(n,{A:()=>o});t(65043);var a=t(27879),r=t(70579);function o(){const e={SAFE:"SAFE","Convertible Debt":"Convertible Debt","Preferred Equity":"Preferred Equity","Common Equity":"Common Equity",Warrants:"Warrants","Instrument Comparisons":"Instrument Comparisons","Investor Reporting":"Investor Reporting","Data Room & Due Diligence":"Data Room & Due Diligence","Dilution & Ownership Modeling":"Dilution","Fundraising Rounds & Process":"Fundraising","Valuation Fundamentals":"Valuation","Vesting & Equity Compensation":"Vesting","Governance & Shareholder Rights":"Governance","M&A, Exits & Liquidity":"M&A & Exit","Angel Investing Fundamentals":"Angel Investing","Founder-Investor Relationships":"Founder-Investor Relationships","Term Sheet Structure and Fundamentals":"Term Sheets"};return(0,r.jsx)(r.Fragment,{children:a.i.map(((n,t)=>(0,r.jsx)("div",{className:"knowledge__tag",onClick:()=>(e=>{window.dispatchEvent(new CustomEvent("openCategoryModal",{detail:e}))})(n),children:e[n.name]||n.name},t)))})}}}]);
//# sourceMappingURL=4591.4986a228.chunk.js.map