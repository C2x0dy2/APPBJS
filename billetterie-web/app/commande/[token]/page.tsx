import { Order } from '../../public-app';
export default async function Page({params}:any){const {token}=await params;return <Order token={token}/>;}
