import { useControlledModal } from "@/hooks/useControlledPopup";
import { Button, Modal } from "antd";
import styles from './index.module.scss';
import { dispatchPageActionRequest } from "@/pages/bridge";



function Home() {

  const [openModal, modalNode] = useControlledModal();
  const handleClick = () => {
    openModal({
      title: "test",
      children: <div>test</div>,
      onOk: async () => {
        console.log('====onOk');
        try {
          const res = await dispatchPageActionRequest('test', ['hello']);
          console.log('====res', res);
          Modal.success({
            title: 'success',
            content: String(res || '--'),
          });
        } catch (error) {
          console.log('====error', error);
        }
      }
    });
  };

  return (
    <div className={styles.container}>
      <Button onClick={handleClick}>test</Button>
      {modalNode}
    </div>
  );
}

export default Home;