/**
 * Created by zhuqizhong on 17-5-15.
 */

const ModbusBase = require('yeedriver-modbustcpconv');
const _ = require('lodash');
const P = require('bluebird');
const MODE={
    UNDEF:0,
    VENT:1,  //风机
    HEAT:2,  //制热
    COLD:3,  //制冷
    HUMITY:4, //除湿
    AUTO:5
};

const MODE_VALUE={
    1:0,  //风机
    2:1,  //制热
    3:2,  //制冷
    4:7, //除湿
    5:3
};

const SENSE_STATE={
    UNKNOWN:0,
    NORMAL:1,
    FAULT:2
};

const WQ_ID={
    power:1,
    mode:2,
    target_temp:3,
    ventile:4,
    filter_req:5,
    fault_code:6,
    sensor_state:7,
    house_temp:8,
    connected:60001

};

const FAULT_C1 = ['0','1','2','3','4','5','6','7','8','9','A','H','C','J','E','F'];
const FAULT_C2 = ['0','A','C','E','H','F','J','L','P','U','9','8','7','6','5','4','3','3','2','1','G','K','M','N','R','T','V','W','X','Y','Z','*',' ']
class  IRACC  {
    constructor(devId,writer) {


        this.devId = devId;
        this.ventile = undefined;  //风量 从1到5  归一化成20-100
        this.power = false;        //开关
        this.filterReq = false;    //过滤网清洗标志
        this.mode =  MODE.UNDEF;        //0 送风 1 制热 2制冷 3 除湿
        this.target_temp = undefined;
        this.house_temp = undefined;
        this.fault_code = "00";
        this.sensor_state = SENSE_STATE.UNKNOWN;
        this.connected = false;
        this.address = devId.match(/^AC(\d+)_(\d+)/i);
        this.mbWriter = writer;

    }

    //分解状态
    /**
     * 根据modbus更新状态信息
     * @param data
     */
    updateACState(data){
        if(data && data.length >= 6){
            this.ventile = data[0] >> 12; //风量
            this.power = !!(data[0]&0xff);
            this.filter_req =  ((data[1]>>8)=== 0x42); //过虑网清洗标志
            switch(data[1]&0x0f){
                case 0:
                    this.mode = MODE.VENT;
                    break;
                case 1:
                    this.mode = MODE.HEAT;
                    break;
                case 2:
                    this.mode = MODE.COLD;
                     break;
                case 3:
                    this.mode = MODE.AUTO;
                    break;
                case 0x07:
                    this.mode = MODE.HUMITY;
                    break;
            }
            this.target_temp = data[2]/10;
            this.fault_code = FAULT_C2[(data[3]>>8)] + FAULT_C1[data[3]&0xff];
            this.house_temp = data[4]/10;
            this.sensor_state = ((data[5])==0x0000);
            this.connected = true;
        }


    }

    WriteWQ(reg, value) {
        return this.CtrlAC(reg,value);
    }

    ReadWQ (reg){


            switch(reg){
                case WQ_ID.power: //PH
                    return this.power;
                    break;
                case WQ_ID.mode:
                    return this.mode;
                    break;
                case WQ_ID.ventile:
                    return this.ventile;
                    break;
                case WQ_ID.target_temp:
                    return this.target_temp;
                    break;
                case WQ_ID.house_temp:
                    return this.house_temp;
                    break;
                case WQ_ID.sensor_state:
                    return this.sensor_state;
                    break;
                case WQ_ID.filter_req:
                    return this.filter_req;
                    break;
                case WQ_ID.fault_code:
                    return this.fault_code;
                    break;
                case WQ_ID.connected:
                    return this.connected;
                    break;
                default:
                    return undefined;
                    break;
            }


    };

    setConnected(state){
        this.connected = state;
    }
    CtrlAC(wq_id,value){

    if(this.address && this.address.length >= 3){
        let writeBuf = {
            func:0x06,
            ac_devId:parseInt(this.address[1]),

        };
        switch(wq_id){
            case WQ_ID.power: //PH
                writeBuf.reg_addr=parseInt(this.address[2]*3+0x07d0);
                writeBuf.reg_value=(0xff<<8)+((value?0x61:0x60));
                break;
            case WQ_ID.ventile:
                writeBuf.reg_addr=parseInt(this.address[2]*3+0x07d0);
                writeBuf.reg_value=(parseInt(value)<<12)+0xff;
                break;
            case WQ_ID.mode:
                let mode = 0;
                writeBuf.reg_addr = parseInt(this.address[2]*3+0x7d0) +1;
                switch(value){
                    case  MODE.VENT:
                        mode = 0;
                        break;
                    case MODE.HEAT:
                        mode = 1;
                        break;
                    case MODE.COLD:
                        mode = 2;
                        break;
                    case MODE.HUMITY:
                        mode = 7;
                        break;
                    case MODE.AUTO:
                        mode = 3;
                        break;
                }
                writeBuf.reg_value=mode;
                break;
            case WQ_ID.target_temp:
                writeBuf.reg_addr = parseInt(this.address[2]*3+0x7d0) +2;
                let temp_val =parseInt(value*10);
                writeBuf.reg_value=temp_val;//(temp_val>>8)&0xff,temp_val&0xFF];
                break;
        }

        // let writeBuf = {
        //     func:0x10,
        //     ac_devId:parseInt(this.address[1]),
        //     reg_start:parseInt(this.address[2]*3+0x07d0),
        //     reg_values:[]
        //
        // };
        // writeBuf.reg_values.push((this.ventile<<12) + (this.power?0x61:0x60));
        // writeBuf.reg_values.push(MODE_VALUE[this.mode]||0);
        // writeBuf.reg_values.push(this.target_temp*10);
        //
        // switch(wq_id){
        //     case WQ_ID.power: //PH
        //         writeBuf.reg_values[0]=(writeBuf.reg_values[0] & 0xff00) + (value?0x61:0x60);
        //         break;
        //     case WQ_ID.ventile:
        //         writeBuf.reg_values[0]=(parseInt(value)<<12)+(writeBuf.reg_values[0]&0x0fff);
        //         break;
        //     case WQ_ID.mode:
        //         writeBuf.reg_values[1]=MODE_VALUE[value || 0];
        //         break;
        //     case WQ_ID.target_temp:
        //         writeBuf.reg_values[2]=value*10;
        //         break;
        // }

        return this.mbWriter.sendCtrl(writeBuf);
    }else{
        return P.reject(`error of devId:${this.devId} `);
    }

    }
}
module.exports = IRACC;