/**
 * Created by zhuqizhong on 17-8-16.
 */
const ModbusBase = require('yeedriver-modbustcpconv');
const MBase = ModbusBase.ModbusBase;
/**
 * Created by zhuqizhong on 16-12-2.
 */

const JobQueue = require('qz-jobqueue').JobQueue;
const ModbusRTU = require("qz-modbus-serial");
const util = require('util');

const _ = require('lodash');
const vm = require('vm');
const MAX_WRITE_CNT = 50;
const IRACC = require('./iracc');
/**
 * sids的说明
 *
 * 第一版本  {devId,devType}
 *
 */
class IRACCMaster extends ModbusBase {
    constructor(maxSegLength, minGapLength){
        super(8, 1);

        this.jobQueue = new JobQueue({consumer:this.doSendData.bind(this)});
        this.curCallIndex = 0;
        this.call_buffer = [];


        let callACState = ()=>{
            this.autoCallHandler = null;
            if(this.curCallIndex < this.call_buffer.length){
                let sendData =  _.clone(this.call_buffer[this.curCallIndex]);
                this.sendCtrl(sendData).then((data)=>{
                    this.devices[sendData.devId] && this.devices[sendData.devId].updateACState(data);
                    this.emit('RegRead',{devId:devId ,memories:this.autoReadMaps[devId]});
                }).finally(()=>{
                    this.curCallIndex++;
                    if(this.curCallIndex >= this.call_buffer.length){
                        this.curCallIndex = 0;
                    }
                    this.autoCallHandler = setTimeout(function(){callACState();},200);
                })
            }
            else{
                this.autoCallHandler = setTimeout(function(){callACState();},200);
            }
        }
        this.autoCallHandler = setTimeout(callACState,100);

    }

    initDriver(options) {
        super.initDriver(options)

        this.sids = options.sids || {}  ;

        this.ids = options.ids.split(',') || [];

        this.call_buffer =  [];

        this.drivers = this.drivers || [];

        _.each(options.sids,(data,devId)=>{
            if (!this.devices[devId]){
                let matchId = devId.match(/^AC(\d+)_(\d+)/i);
                if(_.indexOf(this.ids,matchId[1])>=0){
                    this.devices[devId] = new IRACC(devId, this);
                    this.call_buffer.push({
                        devId: devId,
                        func: 0x04,
                        ac_devId: matchId[1],
                        reg_start: 0x07d0 + 6 * matchId[2],
                        reg_len: 6
                    });
                }
            }
        })

        setTimeout(()=>{
            _.each(this.ids,(mbId)=>{
                let ctrlData = {func: 0x04, ac_devId: mbId, reg_start: 0x01, reg_len: 4};
                this.sendCtrl(ctrlData).then((data) => {
                    for (let i = 0; i < 4 && i < (data ? data.length : 0); i++) {
                        for (let j = 0; j < 16; j++) {
                            if (data[i] & (1 << j)) {
                                let index = ((i * 16) + j);
                                let devId = 'AC' + mbId + "_" + index;
                                if (this.devices[devId]) {
                                    this.devices[devId].setConnected(true);
                                }
                            }

                        }
                    }
                })
            });

            this.setRunningState(this.RUNNING_STATE.CONNECTED);
        },500)

        this.setupEvent();

    }


    ReadWQ(mapItem,devId){
        return this.CreateWQReader(mapItem,function(reg){
            if(!this.devices[devId]){
                return undefined;
            }else{
                return this.devices[devId].ReadWQ(reg);
            }
        });
    }

    WriteWQ(mapItem,values,devId){
        return this.CreateWQWriter(mapItem,values,function(reg,value){
            if(this.devices[devId]){
                return this.devices[devId].WriteWQ(reg,value)
            }
        });
    }

    release(){
        clearInterval(this.autoCallHandler);
    };
}


/**
 *
 * @param options
 * sids 里是iracc的配置信息，
 *
 * mb_devId:acIDMask
 *
 * mb_devId是iracc的控制器地址, acId是里面每一台空调的地址
 */

IRACCMaster.prototype.sendCtrl=function(data){

    return this.jobQueue.push(data);
}
IRACCMaster.prototype.doSendData = function(data){
    if(this.mbClient){
        this.mbClient.setID(data.ac_devId);
        switch(data.func){
            case 0x01:
                return this.mbClient.readCoils(data.reg_start, data.reg_len).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x02:
                return this.mbClient.readDiscreteInputs(data.reg_start, data.reg_len).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x03:
                return this.mbClient.readHoldingRegisters(data.reg_start, data.reg_len).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x04:
                return this.mbClient.readInputRegisters(data.reg_start, data.reg_len).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x05:
                return this.mbClient.writeCoil(data.reg_addr, data.reg_value).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x06:
                return this.mbClient.writeRegister(data.reg_addr, data.reg_value).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x0f:
                return this.mbClient.writeCoils(data.reg_start, data.reg_values).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x10:
                return this.mbClient.writeRegisters(data.reg_start, data.reg_values).then(function(newData){
                    return newData.data;
                });
                break;
        }
    }

}
/*
 * 启动加入设备状态
 *
 */
IRACCMaster.prototype.setInOrEx = function () {
    let addDevices = {};
    let delDevices = {};
    _.each(this.ids, function (mbId) {
        //发一个搜索命令，检查设备是否在线
        let ctrlData = {func:0x04,ac_devId:mbId,reg_start:0x01,reg_len:4};

        this.sendCtrl(ctrlData).then((data)=>{
            for(let i = 0; i < 4 && i <(data?data.length:0);i++){
                for(let j=0;j < 16;j++){
                    let index =((i*16)+j);
                    let devId = 'AC'+mbId+"_"+index;
                    if(!this.sids[devId] && (data[i] & (0x01<<j)) ){
                        addDevices[devId] =  {
                            uniqueId:'ac',
                            groupId:".",
                        }
                        // this.devices[devId] = new IRACC(devId, this);
                        // this.call_buffer.push({
                        //     devId: devId,
                        //     func: 0x04,
                        //     ac_devId: mbId,
                        //     reg_start: 0x07d0 + 6 * index,
                        //     reg_len: 6
                        // });

                    }
                    if(this.sids[devId] && !(data[i] & (0x01<<j)) ){
                        delDevices[devId] = 'ac'
                    }
                }
            }
            if (!_.isEmpty(addDevices))
                this.inOrEx({type: "in", devices: addDevices});//uniqueKey:nodeid,uniqueId:nodeinfo.manufacturerid+nodeinfo.productid})
            //console.log('new Devices:',addDevices);
            if (!_.isEmpty(delDevices)) {
                this.inOrEx({type: "ex", devices: delDevices});
            }
        })


    }.bind(this));
};


module.exports = new IRACCMaster();

