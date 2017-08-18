/**
 * Created by zhuqizhong on 17-8-16.
 */
const ModbusBase = require('yeedriver-modbustcpconv');
const MBase = ModbusBase.ModbusBase;
/**
 * Created by zhuqizhong on 16-12-2.
 */

const JobQueue = require('qz-jobqueue');
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
 */
function IRACCMaster(maxSegLength, minGapLength) {
    ModbusBase.call(this, 8, 1);

    this.jobQueue = new JobQueue({consumer:this.doSendData.bind(this)});
    this.curCallIndex = 0;
    this.call_buffer = [];
    let self = this;
    function callACState(){
        self.autoCallHandler = null;
        if(self.curCallIndex < self.call_buffer.length){
            let sendData =  _.clone(self.call_buffer[self.curCallIndex]);
            self.sendCtrl(sendData).then((data)=>{
                self.devices[sendData.ac_devId] && self.devices[sendData.ac_devId].updateACState(data);
            }).fin(()=>{
                this.curCallIndex++;
                if(this.curCallIndex >= self.call_buffer.length){
                    self.curCallIndex = 0;
                }
                self.autoCallHandler = setTimeout(callACState,200);
            })
        }
    }

    this.autoCallHandler = setTimeout(callACState,200);
}
util.inherits(IRACCMaster, ModbusBase);
IRACCMaster.prototype.release = function(){
    clearInterval(this.autoCallHandler);
};
/**
 *
 * @param options
 * sids 里是iracc的配置信息，
 *
 * mb_devId:acIDMask
 *
 * mb_devId是iracc的控制器地址, acId是里面每一台空调的地址
 */
IRACCMaster.prototype.initDriver = function (options) {
    ModbusBase.prototype.initDriver(options);

    this.call_buffer = [];
    _.each(options.sids, function (data_array, mbId) {
        for(let i = 0; i < (data_array && data_array.length ); i++){
            for(let j=0;j<8;j++){
                let index =((i*8)+j);
                let devId = 'AC'+mbId+"_"+index;
                if(!this.devices[devId])
                    this.devices[devId] = new IRACC(devId, this.mbClient,this);
                this.call_buffer.push({ac_devId:devId,func:0x04,devId:mbId,reg_start:0x07d0+6*index,reg_len:6});
            }
        }
        //发一个搜索命令，检查设备是否在线
        let ctrlData = {func:0x04,devId:mbId,reg_start:0x01,reg_len:4};
        this.sendCtrl(ctrlData).then((data)=>{
            for(let i = 0; i < 8 && i <(data?data.length:0);i++){
                for(let j=0;j < 8;j++){
                    let index =((i*8)+j);
                    let devId = 'AC'+mbId+"_"+index;
                    if(this.devices[devId]){
                        this.devices[devId].setConnected(true);
                    }
                }
            }
        })


    }.bind(this));


};
IRACCMaster.prototype.sendCtrl=function(data){

    return this.jobQueue.push(data);
}
IRACCMaster.prototype.doSendData = function(data){
    if(this.mbClient){
        switch(data.func){
            case 0x01:
                return this.mbClient.readCoils(data.ac_devId,data.reg_start, data.reg_len).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x02:
                return this.mbClient.readDiscreteInputs(data.ac_devId,data.reg_start, data.reg_len).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x03:
                return this.mbClient.readHoldingRegisters(data.ac_devId,data.reg_start, data.reg_len).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x04:
                return this.mbClient.readInputRegisters(data.ac_devId,data.reg_start, data.reg_len).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x05:
                return this.mbClient.writeCoil(data.ac_devId,data.reg_addr, data.reg_value).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x06:
                return this.mbClient.writeRegister(data.ac_devId,data.reg_addr, data.reg_value).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x0f:
                return this.mbClient.writeCoils(data.ac_devId,data.reg_start, data.reg_values).then(function(newData){
                    return newData.data;
                });
                break;
            case 0x10:
                return this.mbClient.writeRegisters(data.ac_devId,data.reg_start, data.reg_values).then(function(newData){
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
    _.each(this.options.sids, function (data_array, mbId) {
        //发一个搜索命令，检查设备是否在线
        let ctrlData = {func:0x04,devId:mbId,reg_start:0x01,reg_len:4};

        this.sendCtrl(ctrlData).then((data)=>{
            for(let i = 0; i < 8 && i <(data?data.length:0);i++){
                for(let j=0;j < 8;j++){
                    let index =((i*8)+j);
                    let devId = 'AC'+mbId+"_"+index;
                    if( (data[i] & (0x01<<j)) !== (data_array[i] & (0x01<<j)) ){
                        if(data[i] & (0x01<<j)){ //这一个设备是新的
                            addDevices[devId] =  {
                                uniqueId:'iracc',
                                groupId:".",
                            }
                        }else{
                            delDevices[devId] = 'iracc'
                        }
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

