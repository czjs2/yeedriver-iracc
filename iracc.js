/**
 * Created by zhuqizhong on 17-5-15.
 */

const ModbusBase = require('yeedriver-modbustcpconv').ModbusBase;
const async = require('async-q');
const _ = require('lodash');
const MODE={
    UNDEF:0,
    VENT:1,  //风机
    HEAT:2,  //制热
    COLD:3,  //制冷
    HUMITY:4, //除湿
    AUTO:5
};
const SENSE_STATE={
    UNKNOWN:0,
    NORMAL:1,
    FAULT:2
};

const WQ_ID={
    power:0,
    ventile:1,
    mode:2,
    target_temp:3,
    house_temp:4,
    filter_req:5,
    sensor_state:6,
    fault_code:7,
    connected:60001

};

const FAULT_C1 = ['0','1','2','3','4','5','6','7','8','9','A','H','C','J','E','F'];
const FAULT_C2 = ['0','A','C','E','H','F','J','L','P','U','9','8','7','6','5','4','3','3','2','1','G','K','M','N','R','T','V','W','X','Y','Z','*',' ']
class  IRACC extends ModbusBase{
    constructor(devId,mbClient,writer) {
        super(devId,mbClient);

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
        if(data && data.length >= 12){
            this.ventile = (data[0] >> 4)*20;
            this.power = !!data[1];
            this.filterReq =  (data[2]=== 0x42);
            switch(data[3]&0x0f){
                case 0:
                    this.mode = MODE.VENT;
                    break;
                case 1:
                    this.mode = MODE.HEAT;
                    break;
                case 2:
                    this.mode = MODE.COLD;
                     break;
                case 0x07:
                    this.mode = MODE.HUMITY;
                    break;
            }
            this.target_temp = (data[4]*100+data[5])/10;
            this.fault_code = FAULT_C2[(data[6]&0x1f)] + FAULT_C1[data[7]&0x0F];
            this.house_temp = (data[8]*100+data[9])/10;
            this.sensor_state = ((data[10])===0x80);
            this.connected = true;
        }


    }

    WriteWQ(mapItem, value) {

        let reg_quantity = (mapItem.end - mapItem.start + 1);

        let regs = [];
        for (let i = 0; i < reg_quantity; i++) {
            let wq_id =mapItem.start + i;
            regs.push(wq_id);


        }
        return async(regs,function(reg){
            return this.CtrlAC(reg,value[reg]);
        }.bind(this))


    }

    ReadWQ (mapItem){

        return this.CreateWQReader(mapItem,function(reg,results){
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
            }
        });

    };

    setConnected(state){
        this.connected = state;
    }
   CtrlAC(wq_id,value){

    if(this.address && this.address.length >= 3){
        let writeBuf = {
            func:0x06,
            devId:parseInt(this.address[1]),
            reg_start:parseInt(this.address[2]*3+0x7d0),
            reg_len:1
        };
        switch(wq_id){
            case WQ_ID.power: //PH
                writeBuf.data=[0xff,!!value?0x61:0x60];
                break;
            case WQ_ID.ventile:
                writeBuf.data=[parseInt(value/20)<<4,0xff];
                break;
            case WQ_ID.mode:
                let mode = 0;
                writeBuf.reg_start = parseInt(this.address[2]*3+0x7d0) +1;
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
                writeBuf.data=[0x00,mode];
                break;
            case WQ_ID.target_temp:
                writeBuf.reg_start = parseInt(this.address[2]*3+0x7d0) +1;
                let temp_val =parseInt(value*10);
                writeBuf.data=[(temp_val>>8)&0xff,temp_val&0xFF];
                break;
        }

        return this.mbWriter.sendCtrl(writeBuf);
    }else{
        return Q.reject(`error of devId:${this.devId} `);
    }

}
}
module.exports = IRACC;