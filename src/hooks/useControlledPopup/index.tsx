
import React, { ReactNode } from 'react';
import { Drawer, Modal, DrawerProps, ModalProps } from 'antd';
import { OpenPopup } from './type';
import { usePopup } from './usePopup';

export function useControlledModal(): [OpenPopup, ReactNode] {
  const { key, open, options, footerNode, childrenNode, openFn, handleAfterClose, handleCancel } = usePopup();

  const modalNode = options ? (
    <Modal
      {...options}
      key={key}
      open={open}
      destroyOnHidden
      afterClose={handleAfterClose}
      footer={footerNode}
      onOk={undefined}
      onCancel={handleCancel}
    >
      {childrenNode}
    </Modal>
  ) : null;

  return [openFn as OpenPopup<ModalProps>, modalNode];
}

export function useControlledDrawer(): [OpenPopup<DrawerProps>, ReactNode] {
  const { key, open, options, footerNode, childrenNode, openFn, handleAfterClose, handleCancel } = usePopup();

  const drawerNode = options ? (
    <Drawer
      {...(options as any)}
      key={key}
      open={open}
      destroyOnHidden
      afterOpenChange={(isOpen) => !isOpen && handleAfterClose()}
      footer={footerNode}
      onClose={handleCancel}
    >
      {childrenNode}
    </Drawer>
  ) : null;

  return [openFn as OpenPopup<DrawerProps>, drawerNode];
}
