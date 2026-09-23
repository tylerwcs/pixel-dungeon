import qrcode from './vendor/qrcode.mjs';

export function drawQR(canvas,value,{dark='#080b20',light='#ffffff'}={}){
  const code=qrcode(0,'L');code.addData(value);code.make();const modules=code.getModuleCount(),quiet=4,total=modules+quiet*2,cell=4,size=total*cell;canvas.width=size;canvas.height=size;const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;context.fillStyle=light;context.fillRect(0,0,size,size);context.fillStyle=dark;for(let row=0;row<modules;row++)for(let column=0;column<modules;column++)if(code.isDark(row,column))context.fillRect((column+quiet)*cell,(row+quiet)*cell,cell,cell);
}
