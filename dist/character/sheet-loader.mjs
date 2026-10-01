// Downloads sprite sheets with one combined progress value (0–1) and returns local object URLs for the views to draw from.
// Hosts that stream without a Content-Length get an estimate, so the bar keeps moving but only reaches 1 when everything is in.
const ESTIMATED_SHEET_BYTES=6e6;

export async function loadSheets(urls,onProgress,{fetchImpl=fetch,createUrl=blob=>URL.createObjectURL(blob)}={}){
  const responses=await Promise.all(urls.map(url=>fetchImpl(url)));
  for(const response of responses)if(!response.ok)throw new Error(response.status===404?'This character is no longer available.':'The videos could not be loaded. Please try again.');
  const totals=responses.map(response=>Number(response.headers.get('content-length'))||ESTIMATED_SHEET_BYTES),received=urls.map(()=>0),total=totals.reduce((sum,size)=>sum+size,0);
  let shown=0;const report=()=>{const value=Math.min(.99,received.reduce((sum,size)=>sum+size,0)/total);if(value>shown){shown=value;onProgress(value);}};
  const blobs=await Promise.all(responses.map(async(response,index)=>{
    const reader=response.body.getReader(),chunks=[];
    for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);received[index]+=value.byteLength;report();}
    return new Blob(chunks,{type:'image/png'});
  }));
  onProgress(1);
  return blobs.map(createUrl);
}
