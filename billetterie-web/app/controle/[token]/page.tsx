import Scanner from '../../scanner-app';
export default async function Page({params}:any){const {token}=await params;return <Scanner token={token}/>;}
