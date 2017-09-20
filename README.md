# IRACC 的yeedriver 的驱动

基于485或是modbusOverTCP的驱动实现。由于一个iracc网关下面，可能会有多个设备，因此实现方式和一个地址下一个设备[yeedriver_mb_sdevs](http://github.com/czjs2/yeedriver_mb_sdevs/)不一样。


## 实现方案

###设备发现
* 一个总线上可以接多个iracc网关，一个网关下面最多接64个内机
    > iracc网关需要通过配置来实现，需要配置网关的devId和所在的SerialPort(或是ip:port)

    
* 接收inOrEx命令，在收到命令时，会自动通过查询命令查询所有的空调内机
    > * 在inOrEx命令时，如果有新内机发现，会通知系统有新设备
    > * 平时每过3分钟，会轮询一次内机的状态，并且更新内机是否在线的状态
* 配置中options.sids的格式

        {
            iracc_mb_id:[ac_mask]
        }
        iracc_mb_id:iracc网关的modbus地址(1,2,3....)
        ac_mask，连接的空调内机的掩码，是一个8个字节的数组，高字节在前，低字节在后,

###系统实现
    
* 基础功能
    > 每个iracc对象存储一台内机的当前映象
    
    > ReadWQ就是从映象中读取数据
    
    > WriteWQ直接通过JobQueue写入一个数据，然后等待数据的回应

* initDriver过程
    > 在initDriver初始化的时候，根据掩码自动生成相应的IRACC内机设备对象
    
    >  执行一次搜索功能，确定IRACC内机对象是否在线
    
    > 根据mask,生成一个自动读取的列表，
    
    > 如果有数据要写入，插入一个写入数据的帧

* 平时动作
    > 启动时，根据initDriver的生成的读取列表，每200ms读取一次空调状态，一次读取6个寄存器，然后更新映象数据
    
    > 如果有要写入的数据，生成写入帧，等当前的操作结束后，就执行一次写入动作
    
    

### 数据格式
写入过程通过分析相应的数据结构，实现实际的写入或是读取的功能

    {
        ac_devId:xxx，  //iracc网关地址
        func:  xxx,    //modbus 操作命令码 0x1,0x02,0x03,0x04,   写入 0x05,0x06,0x0f,0x10
        reg_start:xxx,
        reg_len:xxx,   //这两项是读取(0x01-0x04)的时候用的，从哪个寄存器开始读，读几个寄存器
        reg_addr:xxx,
        reg_value:xxx,  //这两项都是写单个线圈或是寄存器的时候用的
        reg_values:[xxxx]，这个与reg_start配置使用，写多个寄存器时使用，reg_values里是一个数组，数组里的每一项都是对应的要写入寄存器的值的内容，因此在0-65535之间
    }
    
    



   