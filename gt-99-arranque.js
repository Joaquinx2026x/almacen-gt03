// ═══════════════════════════════════════════════════════════
//  ARRANQUE — SIEMPRE el último archivo en cargarse (v3.0.0)
//  Estas tres líneas antes estaban sueltas dentro del código y se
//  ejecutaban al leerse el archivo. Ahora que el código está en varios
//  archivos, deben correr cuando TODOS ya cargaron; por eso viven aquí.
//  No cambies el orden de estas líneas.
// ═══════════════════════════════════════════════════════════
iniciarApp();

rangoRapido("hoy"); // por defecto al cargar la pantalla de Reportes

horRangoRapido("semana"); // rango por defecto del Corte semanal del Horómetro

// ── DIAGNÓSTICO TEMPORAL (GT03): muestra en el login qué Excel y qué backend se están usando.
// Cuando todo funcione, se puede borrar este bloque.
(function(){
  function pintar(){
    try{
      var sub=document.getElementById("loginSub"); if(!sub) return;
      var d=document.getElementById("diagGT");
      if(!d){ d=document.createElement("p"); d.id="diagGT"; d.style.cssText="font-size:10px;color:#888;word-break:break-all;margin:4px 0"; sub.parentNode.insertBefore(d,sub.nextSibling); }
      d.textContent="Excel: …"+String(SHEET_ID).slice(-8)+" · Backend: …"+String(GAS_URL).slice(-14)+" · Proyecto: "+CONFIG.codigoProyecto;
    }catch(e){}
  }
  pintar(); setInterval(pintar,1000);
})();
