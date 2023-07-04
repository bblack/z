"use strict";

var expected=null;
var game=null;
var gameData=null;
var highlightMode="varpitch";
var inputPosition=null;
var isScripted=false;
var jszm=null
var moreHeight=0;
var spacer=null;

function cls() {
  moreHeight=0;
  elem("text").innerHTML="";
  elem("text").appendChild(spacer);
}

function do_key(ev) {
  if(ev.key=="Enter") {
    ev.preventDefault();
    if(game) story_execute(elem("command").value);
  }
}

function do_start() {
  if(!gameData) return false;
  elem("start").disabled=true;
  elem("story").disabled=true;
  jszm=new JSZM(gameData);
  jszm.highlight=story_highlight;
  jszm.print=story_print;
  jszm.restarted=cls;
  jszm.updateStatusLine=jszm.statusType?story_status_time:story_status_score;
  game=jszm.run();
  expected=null;
  story_execute();
  return false;
}

function elem(x) {
  return document.getElementById(x);
}

function file_changed() {
  var x=new FileReader();
  cls();
  elem("start").disabled=true;
  x.onload=ready_to_start;
  x.readAsArrayBuffer(elem("story").files[0]);
  return true;
}

function ready_to_start(e) {
  var a;
  gameData=e.target.result;
  elem("start").disabled=false;
}

function screen_resize() {
  var z=elem("text");
  //var v=z.scrollTop==elem("text").scrollTopMax;
  z.style.display="none";
  z.style.minHeight=z.style.maxHeight=window.innerHeight-elem("screen").clientHeight-9;
  if(!spacer) {
    spacer=document.createElement("div");
    spacer.style.marginTop=spacer.style.marginBottom=0;
    spacer.style.paddingTop=spacer.style.paddingBottom=0;
    z.appendChild(spacer);
  }
  z.style.display="block";
  spacer.style.height=z.clientHeight;
  //if(v) z.scrollTop=z.scrollTopMax;
  return true;
}

function show_input_position() {
  inputPosition=document.createElement("span");
  inputPosition.setAttribute("class","cursor");
  inputPosition.textContent="\u2583";
  elem("text").appendChild(inputPosition);
}

function story_execute(t) {
  if(typeof expected=="number") {
    inputPosition.setAttribute("class",highlightMode+" input");
    inputPosition.textContent=t+"\n";
    inputPosition=null;
    moreHeight=0;
  } else if(expected==JSZM_Terminated) {
    return;
  } else if(expected==JSZM_MorePrompt) {
    elem("text").scrollTop+=elem("text").clientHeight;
    moreHeight-=elem("text").clientHeight;
    if(moreHeight<0) moreHeight=0;
  }
  expected=game.next(t).value;
  elem("command").placeholder="";
  elem("command").value="";
  elem("command").focus();
  elem("command").maxLength=0;
  if(expected==JSZM_MorePrompt) {
    elem("command").placeholder="[MORE]";
  } else if(expected==JSZM_SavePrompt || expected==JSZM_RestorePrompt) {
    return story_execute();
  } else if(expected==JSZM_Terminated) {
    elem("command").placeholder="[DONE]";
  } else if(typeof expected=="number") {
    moreHeight=0;
    elem("command").maxLength=expected;
    show_input_position();
  }
}

function story_highlight(x) {
  highlightMode=x?"fixpitch":"varpitch";
}

function story_print(x) {
  var z=elem("text");
  var e=document.createElement("span");
  var t=document.createTextNode(x);
  var y=z.scrollTop;
  e.setAttribute("class",highlightMode);
  e.appendChild(t);
  z.appendChild(e);
  moreHeight+=z.scrollTopMax-y;
  if(moreHeight>z.clientHeight) {
    z.scrollTop+=z.clientHeight;
    return true;
  } else {
    z.scrollTop=z.scrollTopMax;
    return false;
  }
}

function story_status_score(title,score,moves) {
  elem("status").textContent=title;
}

function story_status_time(title,hours,minutes) {
  elem("status").textContent=title;
}
