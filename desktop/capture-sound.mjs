// A short, local confirmation tone. Audio failure must never affect saving.
export class CaptureSound {
  constructor(enabled=true) { this.enabled=enabled;this.context=null;this.voices=new Set(); }
  setEnabled(enabled) {
    this.enabled=enabled;
    if(!enabled)for(const voice of this.voices){try{voice.stop();}catch{} }
  }
  async unlock() {
    if(!this.enabled)return;
    try{
      const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
      if(!Context)return;
      this.context ||= new Context();
      if(this.context.state==='suspended')await this.context.resume();
    }catch{} // Missing output devices and autoplay restrictions are nonfatal.
  }
  async play() {
    if(!this.enabled)return;
    await this.unlock();
    const ctx=this.context;
    if(!this.enabled||!ctx||ctx.state!=='running')return;
    try{
      const start=ctx.currentTime;
      for(const [frequency,offset] of [[880,0],[1320,.075]]){
        const voice=ctx.createOscillator(),gain=ctx.createGain(),at=start+offset;
        voice.type='sine';voice.frequency.value=frequency;
        gain.gain.setValueAtTime(0,at);
        gain.gain.linearRampToValueAtTime(.12,at+.008);
        gain.gain.exponentialRampToValueAtTime(.001,at+.13);
        voice.connect(gain);gain.connect(ctx.destination);this.voices.add(voice);
        voice.onended=()=>{voice.disconnect();gain.disconnect();this.voices.delete(voice);};
        voice.start(at);voice.stop(at+.15);
      }
    }catch{}
  }
}
