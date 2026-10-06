import { Booking } from '../../public-app';
export default async function Page({params}:any){const {id}=await params;return <Booking id={id}/>;}
