const $=id=>document.getElementById(id);
const time=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false});
// Crew test characters made after the event.
const hidden=new Set(['962ce8d0-7a02-4d33-9f16-17fc76a4e09d']);
let entries=[];

function render(){
  const query=$('gallerySearch').value.trim().toLowerCase(),shown=entries.filter(entry=>entry.key.includes(query));
  $('galleryList').replaceChildren(...shown.map(entry=>entry.item));
  $('galleryStatus').textContent=entries.length&&!shown.length?'No character with that name.':'';
}

async function load(){
  try{
    const response=await fetch('/api/characters?limit=100',{cache:'no-store'});if(!response.ok)throw new Error();
    const {characters}=await response.json();
    // Alphabetical so people can find themselves; the creation time tells apart guests who share a name.
    entries=characters.filter(character=>!hidden.has(character.id)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})||a.createdAt.localeCompare(b.createdAt)).map(character=>{
      const item=document.createElement('li'),link=document.createElement('a'),name=document.createElement('span'),made=document.createElement('time');
      link.href=`/character/?id=${encodeURIComponent(character.id)}`;name.className='gallery-name';name.textContent=character.name;
      made.dateTime=character.createdAt;made.textContent=time.format(new Date(character.createdAt));
      link.append(name,made);item.append(link);return {key:character.name.toLowerCase(),item};
    });
    $('galleryCount').textContent=entries.length?`${entries.length} characters were created at the booth. Tap a name to watch it and download the videos.`:'No characters are available any more.';
    render();
  }catch{$('galleryCount').textContent='';$('galleryStatus').textContent='The gallery could not be loaded. Please try again.';$('galleryStatus').classList.add('error');}
}
$('gallerySearch').addEventListener('input',render);load();
