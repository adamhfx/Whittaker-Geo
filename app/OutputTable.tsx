"use client";
import {useEffect,useId,useMemo,useRef,useState} from "react";
import {formatOutputValue,type OutputSheet} from "@/lib/live-calculation";
import {annualTables} from "@/lib/output-table";
import {RawOutputTable} from "./RawOutputTable";
import "./output-table.css";

export function OutputTable({sheet,label}:{sheet:OutputSheet;label:string}) {
  const [block,setBlock] = useState(0);
  const blocks = useMemo(() => annualTables(sheet),[sheet]);
  const activeBlock = blocks[block] ? block : 0;
  const model = blocks[activeBlock];
  const [groupId,setGroupId] = useState("all");
  const [allCells,setAllCells] = useState(false);
  const selectId = useId();
  const content = useRef<HTMLTableElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const [width,setWidth] = useState(0);
  const selectedGroup = model?.groups.find(group => group.id === groupId);
  const columns = model?.columns.filter(item => !selectedGroup || item.column === model.yearColumn || selectedGroup.columns.includes(item.column)) ?? [];
  useEffect(() => {
    const region = viewport.current, table = content.current;
    if (!region || !table) return;
    const measure = () => {setWidth(table.scrollWidth > region.clientWidth+1 ? table.scrollWidth : 0);
      if (top.current) top.current.scrollLeft=region.scrollLeft;};
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(region);observer.observe(table);
    return () => observer.disconnect();
  },[sheet,groupId,allCells]);
  const sync = (source:HTMLDivElement,target:HTMLDivElement|null) => {
    if (target && Math.abs(target.scrollLeft-source.scrollLeft)>1) target.scrollLeft=source.scrollLeft;
  };
  if (!model) return <RawOutputTable sheet={sheet} label={label}/>;
  return <div className="annual-output">
    <div className="annual-output__controls">
      {!allCells && blocks.length > 1 && <label>Table
        <select aria-label="Output table" className="select" value={activeBlock} onChange={event=>{setBlock(Number(event.target.value));setGroupId("all");}}>
          {blocks.map((item,index)=><option value={index} key={item.yearColumn}>{item.label}</option>)}
        </select>
      </label>}
      {!allCells && model.groups.length > 1 && <label htmlFor={selectId}>Columns
        <select id={selectId} aria-label="Output column group" className="select" value={selectedGroup?.id ?? "all"} onChange={event=>setGroupId(event.target.value)}>
          <option value="all">All annual columns</option>
          {model.groups.map(group=><option key={group.id} value={group.id}>{group.label}</option>)}
        </select>
      </label>}
      <button type="button" className="btn" aria-pressed={allCells} onClick={()=>setAllCells(value=>!value)}>
        {allCells ? "Back to annual table" : "View all output cells"}
      </button>
    </div>
    {allCells ? <RawOutputTable sheet={sheet} label={label}/> : <>
      <p className="small annual-output__hint">Year and column headings stay visible as you scroll. The Excel export includes every output column.</p>
      <div className="annual-output__top-scroll" ref={top} hidden={!width} role="region" tabIndex={0}
        aria-label={`Top horizontal scrollbar for ${label}`} onScroll={event=>sync(event.currentTarget,viewport.current)}>
        <div style={{width,height:1}}/>
      </div>
      <div className="annual-output__viewport" ref={viewport} tabIndex={0} role="region"
        aria-label={`Scrollable ${label} output values`} onScroll={event=>sync(event.currentTarget,top.current)}>
        <table className="annual-output__table" ref={content} aria-label={`${label} output values`}>
          <thead><tr>{columns.map(item=><th scope="col" key={item.column} className={item.column===model.yearColumn?"is-year":""}>
            {item.label}{item.unit && <span>{item.unit}</span>}
          </th>)}</tr></thead>
          <tbody>{model.rows.map((row,index)=><tr key={index}>{columns.map(item=>{
            const cell=row.find(value=>value.column===item.column);
            return <td key={item.column} className={item.column===model.yearColumn?"is-year":""}>
              {cell ? formatOutputValue(cell.value,cell.format) : ""}
            </td>;
          })}</tr>)}</tbody>
        </table>
      </div>
    </>}
  </div>;
}
