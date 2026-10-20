function accessBlock({text='',url='',status=200,passwordVisible=false}={}) {
  if(status===429 || /try again later|temporarily blocked|too many requests|unusual activity/i.test(text)) return 'rate_limit_or_restriction';
  if(status===401 || status===403 || /\/(checkpoint|challenge|login)(?:\/|\?|$)/i.test(url) || passwordVisible) return 'login_or_checkpoint';
  if(/captcha|confirm you.re human|verify you.re human|security check|confirm your identity/i.test(text)) return 'challenge';
  return null;
}
async function assertAccess(page,response) {
  const text=await page.locator('body').innerText();
  const passwordVisible=await page.locator('input[type="password"]').first().isVisible().catch(()=>false);
  const reason=accessBlock({text,url:page.url(),status:response?.status()||200,passwordVisible});
  if(reason){const e=new Error(`Facebook access paused: ${reason}. Owner action required; no bypass or automatic retry.`);e.accessBlocked=true;throw e;}
}
module.exports={accessBlock,assertAccess};
