import{S as b,k as S,N as t,R as y,a as x,T as l,Y as d,r as u,a0 as v,$ as w,H as E}from"./main-MQVnImUi.js";const j="https://www.reelintel.ai/brand/email-signature.png",f="https://www.reelintel.ai";function A({name:n,title:e,email:s,phone:o}){return`
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
  <tr>
    <td valign="top" style="padding:0 22px 0 0">
      <img src="${j}" alt="ReelIntel — fish smarter, catch more"
           width="196" style="display:block;width:196px;height:auto;border:0;border-radius:10px">
    </td>
    <td style="width:3px;background-color:#19D4F2;font-size:0;line-height:0">&nbsp;</td>
    <td valign="top" style="padding:2px 0 0 22px">
      <div style="font-size:23px;font-weight:800;color:#0B1F33;letter-spacing:-0.2px;line-height:1.2">${n}</div>
      <div style="margin-top:5px;font-size:12px;font-weight:700;color:#19A8C4;letter-spacing:1.1px;text-transform:uppercase">${e} &nbsp;|&nbsp; ReelIntel</div>
      <div style="margin-top:14px;font-size:15px;color:#334155;line-height:1.5">Fishing intelligence built for anglers.</div>
      <div style="margin-top:4px;font-size:13px;color:#64748B;line-height:1.5">Fish ID &nbsp;•&nbsp; Regulations &nbsp;•&nbsp; Catch insights</div>${`
      <div style="margin-top:12px;font-size:13px;color:#334155;line-height:1.7">${`<a href="mailto:${s}" style="color:#19A8C4;text-decoration:none;font-weight:600">${s}</a>`}${o?"&nbsp;&nbsp;·&nbsp;&nbsp;":""}${o?`<a href="tel:${String(o).replace(/[^0-9+]/g,"")}" style="color:#334155;text-decoration:none">${o}</a>`:""}</div>`}
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:16px">
        <tr>
          <td bgcolor="#19D4F2" style="background-color:#19D4F2;border-radius:8px">
            <a href="${f}" style="display:inline-block;padding:11px 20px;font-size:13px;font-weight:800;letter-spacing:0.6px;color:#062033;text-decoration:none;text-transform:uppercase">Explore ReelIntel &nbsp;&rarr;</a>
          </td>
          <td style="padding-left:14px;font-size:13px;color:#64748B">
            <a href="${f}" style="color:#64748B;text-decoration:none">www.reelintel.ai</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim()}const k=[{name:"Rob Boot",title:"Founder",email:"robert@reelintel.ai"},{name:"Annelies Boot",title:"Project Manager",email:"annelies@reelintel.ai",phone:"678.834.4488"}];A(k[0]);new Map(b.map(n=>[n.id,n.commonName]));S.find(n=>n.key==="troll_pelagic").species;function B(n){return t.jsx(C,{onExit:n.onExit,children:t.jsx(z,{...n})})}class C extends y.Component{constructor(e){super(e),this.state={err:null}}static getDerivedStateFromError(e){return{err:e}}componentDidCatch(e,s){console.error("[admin]",e,s)}render(){if(!this.state.err)return this.props.children;const e=this.state.err;return t.jsx(m,{title:"Admin — Crashed",onExit:this.props.onExit,children:t.jsxs(x,{children:[t.jsxs("p",{style:{margin:0,fontSize:13,color:l.closed,fontWeight:700},children:[(e==null?void 0:e.name)||"Error",": ",(e==null?void 0:e.message)||String(e)]}),(e==null?void 0:e.stack)&&t.jsx("pre",{style:{marginTop:10,fontSize:10,color:l.inkSoft,whiteSpace:"pre-wrap",overflow:"auto",maxHeight:240},children:String(e.stack)})]})})}}function z({localAnglerEmail:n,onExit:e}){const[s,o]=d.useState(null),[R,h]=d.useState(!1),g=d.useRef(!1);return d.useEffect(()=>{let c=!0;const r=u();if(!r){h(!0);return}r.auth.getSession().then(({data:i})=>{c&&(o(i.session||null),h(!0))});const{data:a}=r.auth.onAuthStateChange((i,p)=>{o(p||null)});return()=>{var i,p;c=!1,(p=(i=a==null?void 0:a.subscription)==null?void 0:i.unsubscribe)==null||p.call(i)}},[]),d.useEffect(()=>{var c;s&&!g.current&&(g.current=!0,(c=u())==null||c.auth.refreshSession().then(r=>{var a,i;r!=null&&r.error?console.warn("[admin] auth.refreshSession error",r.error):console.log("[admin] auth.refreshSession ok, expires_at=",(i=(a=r==null?void 0:r.data)==null?void 0:a.session)==null?void 0:i.expires_at)}).catch(r=>{console.warn("[admin] auth.refreshSession threw",r)}),v().catch(()=>{}),w().catch(()=>{}))},[s]),t.jsx(I,{onExit:e})}function I({onExit:n}){return t.jsx(m,{title:"Admin — Not configured",onExit:n,children:t.jsx(x,{children:t.jsxs("p",{style:{margin:0,fontSize:13,color:l.inkSoft,lineHeight:1.55},children:["Supabase env vars aren't set. Put ",t.jsx("code",{children:"VITE_SUPABASE_URL"})," and"," ",t.jsx("code",{children:"VITE_SUPABASE_ANON_KEY"})," in a ",t.jsx("code",{children:".env.local"}),", then restart the dev server."]})})})}function m({title:n,children:e,onExit:s,exitLabel:o="← Back to app"}){return t.jsxs("div",{style:{background:l.bgGradient,minHeight:"100vh",color:l.ink,maxWidth:720,margin:"0 auto",padding:16,boxSizing:"border-box",overflowX:"hidden"},children:[t.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:14},children:[t.jsx(E,{size:22,children:n}),s&&t.jsx("button",{onClick:s,style:{background:"transparent",border:"none",color:l.brass,cursor:"pointer",fontSize:13,fontWeight:600,padding:4},children:o})]}),e]})}export{B as default};
